package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

const (
	ssoTestSecret   = "sso-test-client-secret"
	ssoTestCallback = "https://voice-models.example/v1/auth/callback"
	ssoTestClients  = `{"sing":{"name":"广场","secret":"sso-test-client-secret","callback":"https://voice-models.example/v1/auth/callback"}}`
)

func prepareSSOUser(t *testing.T) *model.User {
	t.Helper()
	previousDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	model.DB = db
	t.Cleanup(func() { model.DB = previousDB })

	user := &model.User{
		Username: "sso-user", Password: "unused", DisplayName: "SSO 用户",
		Role: common.RoleCommonUser, Status: common.UserStatusEnabled,
		Group: "default", AuthVersion: 1, Email: "sso@example.com",
	}
	require.NoError(t, db.Create(user).Error)
	return user
}

func ssoTicketRequest(t *testing.T, userID int, target string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, target, nil)
	c.Set("id", userID) // what middleware.UserAuth() provides
	GetSSOTicketURL(c)
	return recorder
}

func TestSSOTicketReturnsSignedCallbackURL(t *testing.T) {
	user := prepareSSOUser(t)
	t.Setenv("SSO_CLIENTS", ssoTestClients)
	gin.SetMode(gin.TestMode)

	recorder := ssoTicketRequest(t, user.Id, "/api/user/sso/ticket?client=sing&state=state-1")
	require.Equal(t, http.StatusOK, recorder.Code)

	body := recorder.Body.String()
	assert.Contains(t, body, `"success":true`)

	var payload struct {
		Data struct {
			URL string `json:"url"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &payload))
	target, err := url.Parse(payload.Data.URL)
	require.NoError(t, err)
	assert.Equal(t, "voice-models.example", target.Host)
	assert.Equal(t, "/v1/auth/callback", target.Path)
	assert.Equal(t, "state-1", target.Query().Get("state"))

	code := target.Query().Get("code")
	require.NotEmpty(t, code)
	parsed, err := jwt.Parse(code, func(*jwt.Token) (interface{}, error) {
		return []byte(ssoTestSecret), nil
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithAudience("sing"))
	require.NoError(t, err)
	claims, ok := parsed.Claims.(jwt.MapClaims)
	require.True(t, ok)
	assert.Equal(t, "sso-user", claims["username"])
	assert.Equal(t, "SSO 用户", claims["name"])
	assert.Equal(t, "sing", claims["aud"])
	exp := int64(claims["exp"].(float64))
	assert.LessOrEqual(t, exp-time.Now().Unix(), int64(60))
}

func TestSSOTicketRejectsUnknownClientAndBadState(t *testing.T) {
	user := prepareSSOUser(t)
	t.Setenv("SSO_CLIENTS", ssoTestClients)
	gin.SetMode(gin.TestMode)

	recorder := ssoTicketRequest(t, user.Id, "/api/user/sso/ticket?client=unknown&state=state-2")
	assert.Contains(t, recorder.Body.String(), "单点登录应用未配置")

	recorder = ssoTicketRequest(t, user.Id, "/api/user/sso/ticket?client=sing&state=bad%20state")
	assert.Contains(t, recorder.Body.String(), "state")
}

func TestSSOClientsFallsBackToLegacyPair(t *testing.T) {
	t.Setenv("SSO_CLIENTS", "")
	t.Setenv("OCTOP_SSO_SECRET", "legacy-secret")
	t.Setenv("OCTOP_SSO_CALLBACK", "https://octop.example/callback")
	clients := service.SSOClients()
	legacy, ok := clients["octop"]
	require.True(t, ok)
	assert.Equal(t, "legacy-secret", legacy.Secret)
	assert.Len(t, clients, 1)
}

func TestSSOClientsSkipsInvalidEntries(t *testing.T) {
	t.Setenv("SSO_CLIENTS", `{"broken":{"secret":"x","callback":"not-a-url"},"disabled":{"secret":"y","callback":"https://a.example/cb","disabled":true},"ok":{"secret":"z","callback":"https://b.example/cb"}}`)
	t.Setenv("OCTOP_SSO_SECRET", "")
	t.Setenv("OCTOP_SSO_CALLBACK", "")
	clients := service.SSOClients()
	require.Len(t, clients, 1)
	assert.Contains(t, clients, "ok")
}
