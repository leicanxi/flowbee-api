package controller

import (
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// ============================================================================
// 反馈中心（FeedLog）单点登录
//
// 改造#31：侧边栏「心愿与反馈」原来直接外链 post.flowbee.top，用户到了那边
// 还要再登录一次（两站是不同域，会话 cookie 互不可见）。这里改成由本站
// 签一张身份票带过去，落地即已登录。
//
// FeedLog 用的不是 OAuth / OIDC，而是更朴素的约定：工作区共享密钥 + HS256 JWT。
// 我们把只含 email / name / exp 的令牌放进 URL，交给 /api/sso/jwt，它验签后
// 按**邮箱** find-or-create 用户并写下自己的会话 cookie。
//
// 三件必须守住的事：
//  1. 密钥只存在于服务端环境变量，绝不能下发到前端 —— 拿到它就能冒充任意邮箱。
//  2. 身份键是邮箱。没有邮箱的用户签不出令牌（FeedLog 侧也会建不了号），
//     所以只能在这一步挡住并引导去绑定。
//  3. 令牌会实打实地出现在浏览器地址栏（302 的 Location），有效期按"够跳一次"给。
// ============================================================================

const (
	// feedLogSiteURL 反馈中心站点根地址。写死是对的：它同时也决定了 return_to，
	// 而 return_to 必须落在 FeedLog 自己的域内。
	feedLogSiteURL = "https://post.flowbee.top"
	// feedLogSSOSecretEnv 工作区签名密钥的环境变量名。
	// 取值在 FeedLog 后台「开发者 → 单点登录 → 签名密钥」。
	feedLogSSOSecretEnv = "FEEDLOG_SSO_SECRET"
	// feedLogSSOTokenTTL 令牌有效期。跳转是即时的，只需覆盖"点一下到浏览器发出请求"，
	// 过期窗口越短越好。FeedLog 侧有 60 秒时钟容差，5 分钟足够宽松。
	feedLogSSOTokenTTL = 5 * time.Minute
)

// GetFeedbackSSOURL 为当前登录用户签发一个 Feedback 中心单点登录地址。
//
// 返回地址而不是直接 302：前端要在跳转前给"没绑邮箱"这类受阻情况一句人话，
// 让用户点着 302 一路撞进错误页是最差的做法。
func GetFeedbackSSOURL(c *gin.Context) {
	user, err := model.GetUserById(c.GetInt("id"), false)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	email := strings.TrimSpace(user.Email)
	if email == "" {
		// 前端会先自查邮箱并给出绑定引导，这里是绕过前端直接调用时的兜底。
		common.ApiErrorMsg(c, "请先绑定邮箱后再使用反馈中心")
		return
	}

	secret := strings.TrimSpace(common.GetEnvOrDefaultString(feedLogSSOSecretEnv, ""))
	if secret == "" {
		common.ApiErrorMsg(c, "反馈中心单点登录未配置")
		return
	}

	// FeedLog 只在首次见到某个邮箱时用 name 建号，之后改这里不会同步过去，
	// 所以取用户自己设置过展示名优先，没有再用登录名。
	name := strings.TrimSpace(user.DisplayName)
	if name == "" {
		name = user.Username
	}

	now := time.Now()
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"email": email,
		"name":  name,
		"exp":   now.Add(feedLogSSOTokenTTL).Unix(),
		"iat":   now.Unix(),
	}).SignedString([]byte(secret))
	if err != nil {
		common.ApiError(c, err)
		return
	}

	ssoURL, err := url.Parse(feedLogSiteURL + "/api/sso/jwt")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	query := ssoURL.Query()
	query.Set("jwt", signed)
	query.Set("return_to", feedLogSiteURL+"/")
	ssoURL.RawQuery = query.Encode()

	common.ApiSuccess(c, gin.H{"url": ssoURL.String()})
}
