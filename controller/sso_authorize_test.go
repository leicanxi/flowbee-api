package controller

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
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

// prepareSSOEnv swaps in an in-memory DB with one enabled user and returns the
// raw refresh cookie value of a live session.
func prepareSSOEnv(t *testing.T) (*model.User, string) {
	t.Helper()
	previousDB := model.DB
	previousRedis := common.RedisEnabled
	previousSecret := common.SessionSecret
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}))
	model.DB = db
	common.RedisEnabled = false
	common.SessionSecret = "sso-authorize-test-secret"
	t.Cleanup(func() {
		model.DB = previousDB
		common.RedisEnabled = previousRedis
		common.SessionSecret = previousSecret
	})

	user := &model.User{
		Username: "sso-user", Password: "unused", DisplayName: "SSO 用户",
		Role: common.RoleCommonUser, Status: common.UserStatusEnabled,
		Group: "default", AuthVersion: 1, Email: "sso@example.com",
	}
	require.NoError(t, db.Create(user).Error)
	bundle, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "test-agent")
	require.NoError(t, err)
	return user, bundle.RefreshToken
}

func ssoRequest(target string, refresh string) (*gin.Context, *httptest.ResponseRecorder) {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, target, nil)
	if refresh != "" {
		c.Request.AddCookie(&http.Cookie{Name: service.RefreshCookieName, Value: refresh})
	}
	return c, recorder
}

func TestSSOAuthorizeRedirectsAnonymousVisitorToSignIn(t *testing.T) {
	prepareSSOEnv(t)
	t.Setenv("SSO_CLIENTS", ssoTestClients)
	gin.SetMode(gin.TestMode)

	c, recorder := ssoRequest("/api/user/sso/authorize?client=sing&state=state-1", "")
	GetSSOAuthorize(c)

	require.Equal(t, http.StatusFound, recorder.Code)
	location := recorder.Header().Get("Location")
	assert.True(t, strings.HasPrefix(location, "/sign-in?redirect="), location)
	back, err := url.QueryUnescape(strings.TrimPrefix(location, "/sign-in?redirect="))
	require.NoError(t, err)
	assert.Equal(t, "/api/user/sso/authorize?client=sing&state=state-1", back)
}

func TestSSOAuthorizeIssuesTicketForLoggedInUser(t *testing.T) {
	_, refreshToken := prepareSSOEnv(t)
	t.Setenv("SSO_CLIENTS", ssoTestClients)
	gin.SetMode(gin.TestMode)

	c, recorder := ssoRequest("/api/user/sso/authorize?client=sing&state=state-2", refreshToken)
	GetSSOAuthorize(c)

	require.Equal(t, http.StatusFound, recorder.Code)
	location := recorder.Header().Get("Location")
	target, err := url.Parse(location)
	require.NoError(t, err)
	assert.Equal(t, "voice-models.example", target.Host)
	assert.Equal(t, "/v1/auth/callback", target.Path)
	assert.Equal(t, "state-2", target.Query().Get("state"))

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

	// The session refresh rotates the cookie; the browser must get the new one.
	assert.Contains(t, recorder.Header().Get("Set-Cookie"), service.RefreshCookieName)
}

func TestSSOAuthorizeRejectsUnknownClientAndBadState(t *testing.T) {
	prepareSSOEnv(t)
	t.Setenv("SSO_CLIENTS", ssoTestClients)
	gin.SetMode(gin.TestMode)

	c, recorder := ssoRequest("/api/user/sso/authorize?client=unknown&state=state-3", "")
	GetSSOAuthorize(c)
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), "单点登录应用未配置")

	c, recorder = ssoRequest("/api/user/sso/authorize?client=sing&state=bad%20state", "")
	GetSSOAuthorize(c)
	assert.Equal(t, http.StatusOK, recorder.Code)
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
