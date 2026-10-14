package controller

import (
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// ============================================================================
// Octop 单点登录（出站签名者）
//
// 与反馈中心（/api/user/feedback_sso）同一套约定：工作区共享密钥 + HS256 JWT。
// 两处刻意不同：
//  1. 身份键是 **user.Id**。Octop 按 (provider, subject) 关联身份；用邮箱会让
//     大量无邮箱账号进不来，而且用户改邮箱就等于换了一个新号。
//  2. 要把 Octop 生成的 state 原样带回它的回调地址，供它做一次性校验，
//     防止票被翻出来后重放。
//
// 方向也和反馈中心相反：那边的入口在本站，用户已经登录；Octop 的入口在它自己
// 那边，浏览器先整页跳到本站的中转页（/sso/octop），这里才签得出票 —— 所以本
// 接口无需登录态兜底，中转页在 _authenticated 下会先弹登录。
// ============================================================================

const (
	// octopSSOSecretEnv 共享签名密钥的环境变量名。取值与 Octop 后台
	// 「单点登录 → FlowBee → 共享签名密钥」一致。
	octopSSOSecretEnv = "OCTOP_SSO_SECRET"
	// octopSSOCallbackEnv Octop 的回调地址，即它后台展示的那个回调地址。
	// 只在服务端 env 里配置，绝不接受请求参数传入。
	octopSSOCallbackEnv = "OCTOP_SSO_CALLBACK"
	// octopSSOTokenTTL 令牌有效期。跳转是即时的，过期窗口越短越好；Octop 侧有
	// 60 秒时钟容差，5 分钟足够宽松。
	octopSSOTokenTTL = 5 * time.Minute
)

// octopSSOStatePattern 限定 Octop 生成的 state：token_urlsafe 的字符集。
// 它会被拼进跳转地址，收紧字符集可以杜绝 CRLF 之类的注入。
var octopSSOStatePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

// GetOctopSSOURL 为当前登录用户签发一个 Octop 单点登录地址。
//
// 与反馈中心一样返回 {url} 而不是直接 302：中转页要先替用户把"未配置密钥"
// 这类受阻原因讲清楚，让人一头撞进对方的错误页是最差的体验。
func GetOctopSSOURL(c *gin.Context) {
	user, err := model.GetUserById(c.GetInt("id"), false)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	secret := strings.TrimSpace(common.GetEnvOrDefaultString(octopSSOSecretEnv, ""))
	if secret == "" {
		common.ApiErrorMsg(c, "Octop 单点登录未配置")
		return
	}

	// 跳转目标只从环境变量取、不接受请求参数，调用方无法影响它，因此不存在
	// 开放重定向；这里只需确认它本身是个可用的绝对地址。
	callback := strings.TrimSpace(common.GetEnvOrDefaultString(octopSSOCallbackEnv, ""))
	target, err := url.Parse(callback)
	if err != nil || target.Host == "" || (target.Scheme != "http" && target.Scheme != "https") ||
		target.Fragment != "" {
		common.ApiErrorMsg(c, "Octop 单点登录回调地址无效")
		return
	}

	state := strings.TrimSpace(c.Query("state"))
	if !octopSSOStatePattern.MatchString(state) {
		common.ApiErrorMsg(c, "缺少或非法的 state")
		return
	}

	// 展示名优先取用户自己设置过的，没有再用登录名。
	name := strings.TrimSpace(user.DisplayName)
	if name == "" {
		name = user.Username
	}

	now := time.Now()
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":      strconv.Itoa(user.Id),
		"username": user.Username,
		"email":    strings.TrimSpace(user.Email),
		"name":     name,
		"exp":      now.Add(octopSSOTokenTTL).Unix(),
		"iat":      now.Unix(),
	}).SignedString([]byte(secret))
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
