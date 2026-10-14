package controller

import (
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// 改造#40：公开页头像代理
//
// 为什么需要它：公开名单不能直接下发 qlogo 链接 —— 那串地址里的 nk= 就是
// 明文 QQ 号，右键「复制图片地址」就拿到了。代理让访客看到的是本站地址，
// QQ 号只存在于服务端。
//
// 为什么不做 302 重定向：重定向之后浏览器最终仍然会去请求 qlogo，
// DevTools 的网络面板里照样能看到完整地址，等于没代理。必须由服务端
// 把图片字节读回来再吐出去。

const (
	// 上游头像都是 160x160 的小图，正常只有几 KB。留到 2MB 纯粹是防御性的：
	// 上游万一行为异常，也不至于把内存打爆。
	avatarProxyMaxBytes = 2 << 20
	avatarProxyTimeout  = 5 * time.Second
	// 用户可能自己换头像、也可能关掉「使用账号头像」，所以缓存时间不能太长，
	// 否则设置改了浏览器还拿着旧图。半小时是省流量与及时生效的折中。
	avatarProxyCacheControl = "public, max-age=1800"
)

// avatarProxyHTTPClient 独立于 relay 的 client 池：这里只是取一张小图，
// 不需要渠道级的代理、重试和分流配置。
var avatarProxyHTTPClient = &http.Client{Timeout: avatarProxyTimeout}

// GetProxyAvatar 公开的头像代理，路由 /api/avatar/:token。
//
// 未登录可访问：赞助墙本身是公开页。token 带 HMAC 签名，所以这里不需要再
// 额外鉴权 —— 拿不到合法 token 的人根本走不到取图这一步。签名只由
// ListSponsors 对「本来就公开了身份的条目」签发。
func GetProxyAvatar(c *gin.Context) {
	userId, ok := model.ParseAvatarToken(c.Param("token"))
	if !ok {
		c.Status(http.StatusNotFound)
		return
	}

	upstream := model.UserAvatarUpstream(userId)
	if upstream == "" {
		// 用户已封禁 / 关掉了账号头像 / 没有可推导来源，一律按「没有头像」处理。
		// 这里返回 404 而不是一张统一占位图，是为了让前端直接落回它自己的
		// 字母头像：那套底色是按名字哈希出来的，比一张千人一面的图更贴合。
		c.Status(http.StatusNotFound)
		return
	}

	// 上游地址由 model 按固定模板拼出（只可能是 qlogo 或 GitHub），
	// 不接受任何用户输入，因此不存在 SSRF。
	request, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, upstream, nil)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	request.Header.Set("User-Agent", "new-api-avatar-proxy")

	response, err := avatarProxyHTTPClient.Do(request)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		c.Status(http.StatusNotFound)
		return
	}

	contentType := response.Header.Get("Content-Type")
	// svg 也一并挡掉：它能在同源下执行脚本，虽然现在两个上游都不会返回它，
	// 但把「回吐任意 image/*」当成一条不会出事的规则太危险了。
	if !strings.HasPrefix(contentType, "image/") || strings.Contains(contentType, "svg") {
		c.Status(http.StatusNotFound)
		return
	}

	// 多读一个字节用来判断有没有超限：直接 io.LimitReader 会把超出的部分
	// 静默截断，那等于把半张图当整张图发出去。
	body, err := io.ReadAll(io.LimitReader(response.Body, avatarProxyMaxBytes+1))
	if err != nil || len(body) > avatarProxyMaxBytes {
		c.Status(http.StatusNotFound)
		return
	}

	c.Header("Cache-Control", avatarProxyCacheControl)
	c.Data(http.StatusOK, contentType, body)
}
