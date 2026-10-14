package controller

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

const (
	testOctopSecret   = "octop-sso-test-secret-0123456789"
	testOctopCallback = "https://octop.example/api/auth/oauth/callback"
)

type octopSSOResponse struct {
	Success bool           `json:"success"`
	Message string         `json:"message"`
	Data    map[string]any `json:"data"`
}

func setupOctopSSOUser(t *testing.T, displayName string) *model.User {
	t.Helper()
	previousDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	model.DB = db
	t.Cleanup(func() { model.DB = previousDB })

	user := &model.User{
		Username:    "flowbee-user",
		DisplayName: displayName,
		Email:       "flynn@example.com",
		Password:    "unused",
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		AuthVersion: 1,
	}
	require.NoError(t, db.Create(user).Error)
	return user
}

func callOctopSSO(t *testing.T, userID int, rawQuery string) octopSSOResponse {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/user/octop_sso"+rawQuery, nil)
	c.Set("id", userID)
	GetOctopSSOURL(c)

	var payload octopSSOResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload))
	return payload
}

// decodeTicket parses the signed ticket out of a handoff URL using Octop's
// verification recipe: HS256 with the shared secret.
func decodeTicket(t *testing.T, rawURL string) (url.Values, jwt.MapClaims) {
	t.Helper()
	target, err := url.Parse(rawURL)
	require.NoError(t, err)
	ticket, err := jwt.Parse(
		target.Query().Get("code"),
		func(token *jwt.Token) (any, error) { return []byte(testOctopSecret), nil },
		jwt.WithValidMethods([]string{"HS256"}),
	)
	require.NoError(t, err)
	claims, ok := ticket.Claims.(jwt.MapClaims)
	require.True(t, ok)
	return target.Query(), claims
}

func TestGetOctopSSOURLSignsATicketOctopCanVerify(t *testing.T) {
	user := setupOctopSSOUser(t, "Flynn")
	t.Setenv("OCTOP_SSO_SECRET", testOctopSecret)
	t.Setenv("OCTOP_SSO_CALLBACK", testOctopCallback)

	before := time.Now().Unix()
	payload := callOctopSSO(t, user.Id, "?state=octop-state-1")
	after := time.Now().Unix()

	require.True(t, payload.Success, payload.Message)
	rawURL, ok := payload.Data["url"].(string)
	require.True(t, ok, "response carries no url")

	// 跳转目标必须就是我们配置的回调地址：调用方无法影响它，因此不存在开放重定向。
	target, err := url.Parse(rawURL)
	require.NoError(t, err)
	assert.Equal(t, "https", target.Scheme)
	assert.Equal(t, "octop.example", target.Host)
	assert.Equal(t, "/api/auth/oauth/callback", target.Path)

	query, claims := decodeTicket(t, rawURL)
	// state 原样带回，Octop 用它做一次性校验，票才不会被重放。
	assert.Equal(t, "octop-state-1", query.Get("state"))

	// 身份键是 user.Id（不是邮箱）：无邮箱账号也要能登录。
	assert.Equal(t, strconv.Itoa(user.Id), claims["sub"])
	assert.Equal(t, user.Username, claims["username"])
	assert.Equal(t, "Flynn", claims["name"])
	assert.Equal(t, user.Email, claims["email"])

	// Octop 要求 exp 与 iat 都在，且 TTL 是"够跳一次"的五分钟。
	exp, ok := claims["exp"].(float64)
	require.True(t, ok)
	assert.GreaterOrEqual(t, int64(exp), before+300)
	assert.LessOrEqual(t, int64(exp), after+300)
	iat, ok := claims["iat"].(float64)
	require.True(t, ok)
	assert.GreaterOrEqual(t, int64(iat), before)
	assert.LessOrEqual(t, int64(iat), after)
}

func TestGetOctopSSOURLFallsBackToUsernameForName(t *testing.T) {
	user := setupOctopSSOUser(t, "")
	t.Setenv("OCTOP_SSO_SECRET", testOctopSecret)
	t.Setenv("OCTOP_SSO_CALLBACK", testOctopCallback)

	payload := callOctopSSO(t, user.Id, "?state=s")
	require.True(t, payload.Success, payload.Message)

	_, claims := decodeTicket(t, payload.Data["url"].(string))
	assert.Equal(t, "flowbee-user", claims["name"])
}

func TestGetOctopSSOURLRejectsUnusableRequests(t *testing.T) {
	user := setupOctopSSOUser(t, "Flynn")

	tests := []struct {
		name    string
		secret  string
		back    string
		rawQS   string
		wantMsg string
	}{
		{name: "secret not configured", back: testOctopCallback, rawQS: "?state=s", wantMsg: "未配置"},
		{name: "callback not configured", secret: testOctopSecret, rawQS: "?state=s", wantMsg: "回调地址无效"},
		{
			name: "callback is not absolute", secret: testOctopSecret,
			back: "/api/auth/oauth/callback", rawQS: "?state=s", wantMsg: "回调地址无效",
		},
		{
			name: "callback uses a non-http scheme", secret: testOctopSecret,
			back: "ftp://octop.example/cb", rawQS: "?state=s", wantMsg: "回调地址无效",
		},
		{
			name: "state missing", secret: testOctopSecret,
			back: testOctopCallback, rawQS: "", wantMsg: "state",
		},
		{
			name: "state carries unsafe characters", secret: testOctopSecret,
			back: testOctopCallback, rawQS: "?state=a%0Db", wantMsg: "state",
		},
		{
			name: "state is too long", secret: testOctopSecret,
			back: testOctopCallback, rawQS: "?state=" + strings.Repeat("a", 129), wantMsg: "state",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("OCTOP_SSO_SECRET", tt.secret)
			t.Setenv("OCTOP_SSO_CALLBACK", tt.back)

			payload := callOctopSSO(t, user.Id, tt.rawQS)

			assert.False(t, payload.Success)
			assert.Contains(t, payload.Message, tt.wantMsg)
			assert.Empty(t, payload.Data["url"])
		})
	}
}
