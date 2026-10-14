package model

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
)

// 改造#40：公开页头像代理
//
// 公开名单只下发「代理 token」而不是第三方头像地址本身：QQ 邮箱推导出的
// qlogo 链接里 nk= 参数就是明文 QQ 号，直接公开等于把号挂在墙上。
// 代理路径由本站域名 + 一个签名 token 组成，访客看不到 QQ 号，
// 也伪造不出别人的 token。

// 与前端 web/src/lib/avatar.ts 的 QQ_MAIL_PATTERN / NUMERIC_ID_PATTERN 保持一致，
// 两边任意一边调整都必须同步另一边，否则站内和公开页会显示出不同的头像。
// 注意 QQ 邮箱那条必须带 (?i)：前端的 avatar.ts 用的就是大小写不敏感匹配，
// 后端若按敏感处理，`10000@QQ.com` 这种写法会变成「站内有头像、公开页没有」。
var (
	qqMailPattern    = regexp.MustCompile(`(?i)^(\d{5,11})@(?:qq\.com|foxmail\.com|vip\.qq\.com)$`)
	numericIdPattern = regexp.MustCompile(`^\d+$`)
)

// accountAvatarURL 用第三方账号推导头像上游地址，拿不到时返回空串。
//
// QQ 邮箱的数字前缀就是本人的 QQ 号：邮箱只在注册和绑定邮箱时写入，
// 两条路都强制验证码校验，改资料接口也不接受 email 字段，所以推导出的
// 一定是本人的头像。前缀是字母的自定义别名不匹配，自然回退到其它来源。
//
// GitHub 官方头像是 avatars.githubusercontent.com/u/<数字ID>，用数字 ID 而不是
// login 拼接，因为 login 可以被用户改名。
func accountAvatarURL(email string, githubId string) string {
	if match := qqMailPattern.FindStringSubmatch(strings.TrimSpace(email)); match != nil {
		return "https://q1.qlogo.cn/g?b=qq&nk=" + match[1] + "&s=160"
	}
	if id := strings.TrimSpace(githubId); numericIdPattern.MatchString(id) {
		return "https://avatars.githubusercontent.com/u/" + id + "?s=160"
	}
	return ""
}

// isAccountAvatarDisabled 判断用户是否在偏好设置里选择了「使用默认头像」。
//
// 只认 default 一个值：老用户的 setting 里没有这个键，读出来是空，
// 走「使用第三方头像」的默认行为，这样新功能对存量用户直接生效。
func isAccountAvatarDisabled(setting string) bool {
	trimmed := strings.TrimSpace(setting)
	if trimmed == "" {
		return false
	}
	var parsed dto.UserSetting
	if err := common.UnmarshalJsonStr(trimmed, &parsed); err != nil {
		return false
	}
	return parsed.AvatarPreference == dto.AvatarPreferenceDefault
}

// avatarSignature 对 id 字符串算 HMAC 签名，取前 16 个 hex 字符
//（64 位强度足够挡住猜解，长度又不至于把 URL 撑得难看）。
//
// 签名依赖 common.CryptoSecret。默认实现每次启动会随机生成，所以 token
// 只保证在同一个进程生命周期内有效 —— 这没问题，因为名单每次请求都重新签发。
// 但多实例部署时必须给所有实例配同一个 CRYPTO_SECRET，否则实例 A 签发的
// token 到实例 B 会验签失败，图片落回字母头像。
func avatarSignature(idPart string) string {
	mac := hmac.New(sha256.New, []byte(common.CryptoSecret))
	mac.Write([]byte("avatar:" + idPart))
	return hex.EncodeToString(mac.Sum(nil))[:16]
}

// avatarToken 为某个用户签发头像代理 token，格式 `<id>.<sig>`。
//
// 签名用 HMAC 而不是直接暴露 id：这样即使有人改了 id 去猜别人的头像，
// 签名对不上就直接被拒，代理接口不会变成「拉全站用户头像」的入口。
func avatarToken(userId int) string {
	idPart := strconv.Itoa(userId)
	return idPart + "." + avatarSignature(idPart)
}

// ParseAvatarToken 校验并解出 token 里的用户 id，验签失败时返回 false。
func ParseAvatarToken(token string) (int, bool) {
	idPart, signature, found := strings.Cut(token, ".")
	if !found || idPart == "" || signature == "" {
		return 0, false
	}
	userId, err := strconv.Atoi(idPart)
	if err != nil || userId <= 0 {
		return 0, false
	}
	if !hmac.Equal([]byte(signature), []byte(avatarSignature(idPart))) {
		return 0, false
	}
	return userId, true
}

// avatarProxyPathPrefix 是头像代理接口的路径前缀。
// 必须与 router/api-router.go 里注册的路由路径保持一致，改一处要改两处。
const avatarProxyPathPrefix = "/api/avatar/"

// UserAvatarUpstream 返回某个用户「可以公开在名单上」的头像上游地址。
//
// 用户不存在、已封禁、自己关掉了「使用账号头像」，或没有可推导来源（不是
// QQ 邮箱、没绑 GitHub）时返回空串，调用方据此不下发代理路径 / 返回 404。
//
// 注意返回值是 qlogo / GitHub 的原始地址，里面含明文 QQ 号：它只给服务端
// 自己去取图用，绝不能随公开接口下发给浏览器。
func UserAvatarUpstream(userId int) string {
	user, err := GetUserById(userId, false)
	if err != nil || user == nil || user.Status != common.UserStatusEnabled {
		return ""
	}
	return userPublicAvatarUpstream(user)
}

// userPublicAvatarUpstream 判断一个已查出的用户有没有可公开的头像来源。
// 抽出它是为了让 ListSponsors 和头像代理走同一套判定，避免两处逻辑分叉。
// 调用方需自行确认用户的 status 已通过检查。
func userPublicAvatarUpstream(user *User) string {
	if isAccountAvatarDisabled(user.Setting) {
		return ""
	}
	return accountAvatarURL(user.Email, user.GitHubId)
}
