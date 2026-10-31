package controller

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// GetSSOTicketURL returns a signed callback URL for one registered SSO client
// ("log in with FlowBee"). It is bearer-authenticated, exactly like
// /api/user/octop_sso: the front end relay page (/sso/$client) calls it with the
// dashboard access token and then navigates the browser to the returned URL.
//
// The endpoint returns a URL instead of a 302 for the same reason the Octop and
// feedback signers do: the relay page should be able to explain a blocked
// configuration (unknown client, invalid state) instead of dropping the user
// into a foreign error page.
//
// Note: a cookie-authenticated variant is deliberately not used — new-api's
// refresh cookie is path-scoped to /api/user/auth and therefore never reaches
// this route.
func GetSSOTicketURL(c *gin.Context) {
	user, err := model.GetUserById(c.GetInt("id"), false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	clientID := strings.TrimSpace(c.Query("client"))
	client, ok := service.SSOClients()[clientID]
	if !ok {
		common.ApiErrorMsg(c, "单点登录应用未配置")
		return
	}
	state := strings.TrimSpace(c.Query("state"))
	if !octopSSOStatePattern.MatchString(state) {
		common.ApiErrorMsg(c, "缺少或非法的 state")
		return
	}
	target, valid := service.ValidCallback(client.Callback)
	if !valid {
		common.ApiErrorMsg(c, "单点登录回调地址无效")
		return
	}
	signed, err := service.IssueSSOTicket(client, user)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	query := target.Query()
	query.Set("code", signed)
	query.Set("state", state)
	target.RawQuery = query.Encode()
	common.ApiSuccess(c, gin.H{"url": target.String()})
}
