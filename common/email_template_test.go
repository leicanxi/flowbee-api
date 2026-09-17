package common

import (
	"encoding/base64"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestBuildMIMEMessageKeepsLogoInlineAsRelatedPart(t *testing.T) {
	withSMTPSettings(t)
	SystemName = "FlowBee"
	SMTPFrom = "noreply@flowbee.top"

	message := string(buildMIMEMessage(
		"receiver@example.com",
		"邮箱验证邮件",
		"<msg-id@flowbee.top>",
		buildEmailHTML("<p>123456</p>"),
	))

	require.Contains(t, message, "MIME-Version: 1.0")
	require.Contains(t, message, "Content-Type: multipart/related; boundary=\"")
	require.Contains(t, message, "From: FlowBee <noreply@flowbee.top>\r\n")
	require.Contains(t, message, "<p>123456</p>")

	boundaryMatch := regexp.MustCompile(`boundary="([^"]+)"`).FindStringSubmatch(message)
	require.Len(t, boundaryMatch, 2)
	boundary := boundaryMatch[1]

	// 正文通过 cid: 引用内嵌图片，而不是任何外链。
	require.Contains(t, message, `src="cid:`+emailLogoContentID+`"`)
	require.Contains(t, message, "Content-ID: <"+emailLogoContentID+">")
	require.NotContains(t, message, "http://")
	require.NotContains(t, message, "https://")

	parts := strings.Split(message, "--"+boundary+"\r\n")
	require.Len(t, parts, 3, "邮件应只有正文与图片两个 part")

	imagePart := parts[2]
	require.Contains(t, imagePart, "Content-Type: image/png")
	require.Contains(t, imagePart, "Content-Transfer-Encoding: base64")

	encoded := imagePart[strings.Index(imagePart, "\r\n\r\n")+4:]
	encoded = strings.TrimSuffix(encoded, "\r\n--"+boundary+"--\r\n")

	// 单行超过 76 字符会被部分 SMTP 服务器拒绝或截断。
	for _, line := range strings.Split(encoded, "\r\n") {
		require.LessOrEqual(t, len(line), base64LineWidth)
	}

	decoded, err := base64.StdEncoding.DecodeString(strings.ReplaceAll(encoded, "\r\n", ""))
	require.NoError(t, err)
	require.Equal(t, emailLogoPNG, decoded)

	// SMTP 对单行长度有 998 字节上限，超长行会被中间设备截断。
	for _, line := range strings.Split(message, "\r\n") {
		require.LessOrEqual(t, len(line), 998, "SMTP 单行超长: %.60s", line)
	}

	// 换行必须是 CRLF，不能留裸 LF。
	require.NotContains(t, strings.ReplaceAll(message, "\r\n", ""), "\n", "邮件中存在裸 LF 换行")
}

func TestBuildEmailHTMLIsFluidOnMobile(t *testing.T) {
	withSMTPSettings(t)
	SystemName = "FlowBee"

	out := buildEmailHTML("<p>body</p>")

	// 卡片必须随屏幕伸缩：写死 600px 会让手机端整体缩放到不可读。
	require.Contains(t, out, "width:100%;max-width:600px")
	require.NotContains(t, out, "width:600px;max-width:600px")
	require.Contains(t, out, `<meta name="viewport" content="width=device-width,initial-scale=1">`)

	// 排版不依赖 <style> / 媒体查询 / class：QQ 邮箱、微信等客户端对它们的支持不一致，
	// 一旦被剥掉排版就会失效，所以尺寸必须靠内联样式自身就是安全的。
	require.NotContains(t, out, "<style")
	require.NotContains(t, out, "@media")
	require.NotContains(t, out, "class=")

	// Outlook 不支持 max-width，用 MSO 条件注释兜住固定宽度。
	require.Contains(t, out, "<!--[if mso]>")
	require.Contains(t, out, "<!--[if mso]></td></tr></table><![endif]-->")
}

func TestBuildEmailHTMLWrapsContentAndEscapesSystemName(t *testing.T) {
	withSMTPSettings(t)
	SystemName = `Bee & <Hive>`

	out := buildEmailHTML("<p>body</p>")

	require.Contains(t, out, "<!DOCTYPE html>")
	require.Contains(t, out, "<p>body</p>")
	require.Contains(t, out, `src="cid:`+emailLogoContentID+`"`)
	require.Contains(t, out, "Bee &amp; &lt;Hive&gt;")
	require.NotContains(t, out, "Bee & <Hive>")
	require.NotContains(t, out, "__CONTENT__")
	require.NotContains(t, out, "__SYSTEM_NAME__")
}

// narrowPhoneContentWidth 是 340px 屏幕（主流手机下限）上卡片内的可用内容宽度：
// 340 - 2*12（页面留白）- 2*28（卡片内边距）。
const narrowPhoneContentWidth = 340 - 2*12 - 2*28

// 验证码块是整封邮件最宽的元素，它在窄屏上顶破卡片是真实发生过的移动端问题。
// 这个测试把宽度上限钉死，避免以后放大字号 / 字距时无声地弄坏手机端排版。
func TestEmailCodeBlockFitsNarrowPhone(t *testing.T) {
	block := EmailCodeBlock("123456")

	px := func(pattern string) int {
		match := regexp.MustCompile(pattern).FindStringSubmatch(block)
		require.Len(t, match, 2, "未匹配到 %s: %s", pattern, block)
		value, err := strconv.Atoi(match[1])
		require.NoError(t, err)
		return value
	}

	fontSize := px(`font-size:(\d+)px`)
	letterSpacing := px(`letter-spacing:(\d+)px`)
	horizontalPadding := px(`padding:\d+px (\d+)px`)
	const borderWidth = 2

	const digits = 6
	width := digits*fontSize +
		(digits-1)*letterSpacing +
		2*horizontalPadding +
		borderWidth

	require.LessOrEqual(t, width, narrowPhoneContentWidth,
		"验证码块 %dpx 超出窄屏可用宽度 %dpx", width, narrowPhoneContentWidth)
}
