package controller

import (
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// GetSSOAuthorize is the browser entry point of the multi-tenant SSO flow:
//
//	GET /api/user/sso/authorize?client=sing&state=<opaque>
//
// A logged-in dashboard user is redirected straight to the client's registered
// callback with a 60 s HS256 ticket (aud = client id); an anonymous visitor is
// sent to the sign-in page with a redirect back here. The callback target comes
// only from the server-side registry, so no request parameter can steer the
// redirect.
//
// The endpoint is a top-level navigation, so the session-cookie origin guard is
// intentionally not used here (browser navigations carry no Origin header);
// safety comes from the registry-bound callback plus the client's one-time
// state check.
func GetSSOAuthorize(c *gin.Context) {
	setAuthNoStore(c)
	clientID := strings.TrimSpace(c.Query("client"))
	state := strings.TrimSpace(c.Query("state"))
	client, ok := service.SSOClients()[clientID]
	if !ok {
		common.ApiErrorMsg(c, "单点登录应用未配置")
		return
	}
	if !octopSSOStatePattern.MatchString(state) {
		common.ApiErrorMsg(c, "缺少或非法的 state")
		return
	}

	rawRefreshToken, cookieErr := c.Cookie(service.RefreshCookieName)
	if cookieErr != nil || rawRefreshToken == "" {
		redirectToSignIn(c)
		return
	}
	bundle, user, err := service.RefreshLoginSession(
		rawRefreshToken, "", c.ClientIP(), c.Request.UserAgent(),
	)
	if err != nil {
		if errors.Is(err, service.ErrRefreshTokenInvalid) || errors.Is(err, service.ErrLoginSessionRevoked) {
			service.ClearRefreshCookie(c)
		}
		redirectToSignIn(c)
		return
	}
	// RefreshLoginSession rotates the refresh secret; hand the browser the new
	// cookie so its dashboard session keeps working.
	service.WriteRefreshCookie(c, bundle.RefreshToken)

	signed, err := service.IssueSSOTicket(client, user)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	target, valid := service.ValidCallback(client.Callback)
	if !valid {
		common.ApiErrorMsg(c, "单点登录回调地址无效")
		return
	}
	query := target.Query()
	query.Set("code", signed)
	query.Set("state", state)
	target.RawQuery = query.Encode()
	c.Redirect(http.StatusFound, target.String())
}

// redirectToSignIn sends an anonymous visitor to the sign-in page and asks it
// to come back to the same authorize URL after login.
func redirectToSignIn(c *gin.Context) {
	back := url.QueryEscape(c.Request.URL.RequestURI())
	c.Redirect(http.StatusFound, "/sign-in?redirect="+back)
}
