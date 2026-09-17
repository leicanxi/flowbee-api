package common

import (
	_ "embed"
	"html"
	"strings"
)

// 邮件正文的视觉外壳集中在这个文件里。
//
// 邮件客户端不加载外部样式表、也不支持 flex/grid，因此整封邮件使用 table 布局 + 全内联样式；
// 也正因为无法复用 CSS 类，排版复用只能靠这里的组件函数。业务代码只负责内容，不拼外壳。
//
// 移动端适配只做一件事：卡片用「width:100% + max-width:600px」的流式宽度，不写死 600px。
// 写死宽度的邮件在手机上会被整体缩放（600 → 390 约 62%），正文直接被压到不可读。
//
// 刻意不使用 <style> 与媒体查询：QQ 邮箱、微信等客户端的支持并不一致，一旦被剥掉，
// 依赖它的排版就会失效。所以所有尺寸都取「从 340px 到 600px 都安全」的默认值，
// 不需要任何条件生效。唯一例外是 Outlook：它不支持 max-width，只能用 MSO 条件注释
// 兜住固定宽度，这部分没有 CSS 替代方案。

//go:embed assets/email_logo.png
var emailLogoPNG []byte

// emailLogoContentID 是内嵌 logo 的 Content-ID，正文通过 cid: 引用，
// 这样 logo 随邮件一起投递，不依赖外链图片、也不会被邮件客户端默认拦截。
const emailLogoContentID = "flowbee-email-logo"

// emailFontStack 是邮件使用的系统字体栈，不依赖任何外部字体。
const emailFontStack = "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"

const (
	emailColorInk    = "#4C2F1B" // 深棕：标题、按钮底色
	emailColorBody   = "#7A6A56" // 正文
	emailColorMuted  = "#9B8B76" // 辅助文字
	emailColorAccent = "#FCC320" // 主黄：分隔线、按钮文字
	emailColorCanvas = "#F2EBDE" // 页面底色
)

// emailShellTemplate 是统一外壳。占位符用 __XXX__ 形式，避免与正文里的 % 冲突。
const emailShellTemplate = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>__SYSTEM_NAME__</title>
</head>
<body style="margin:0;padding:0;background-color:__CANVAS__;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="__CANVAS__" style="background-color:__CANVAS__;">
<tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#FFFFFF;border-radius:14px;">
<tr><td style="padding:24px 28px 0 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="left" style="vertical-align:middle;"><img src="cid:__LOGO_CID__" width="38" height="38" alt="__SYSTEM_NAME__" style="display:inline-block;width:38px;height:38px;border-radius:10px;vertical-align:middle;border:0;"><span style="display:inline-block;vertical-align:middle;margin-left:10px;font-family:__FONT_STACK__;font-size:18px;font-weight:700;color:__INK__;letter-spacing:-.2px;">__SYSTEM_NAME__</span></td>
</tr></table>
</td></tr>
<tr><td style="padding:16px 28px 0 28px;"><div style="height:3px;background-color:__ACCENT__;border-radius:2px;line-height:3px;font-size:0;">&nbsp;</div></td></tr>
<tr><td style="padding:24px 28px 0 28px;font-family:__FONT_STACK__;">__CONTENT__</td></tr>
<tr><td style="padding:28px 28px 24px 28px;font-family:__FONT_STACK__;"><div style="height:1px;background-color:#F0E8DA;line-height:1px;font-size:0;margin-bottom:14px;">&nbsp;</div><p style="margin:0 0 4px;font-size:13px;line-height:1.7;color:#A89880;">此邮件由系统自动发送，请勿直接回复。</p><p style="margin:0;font-size:13px;line-height:1.7;color:#A89880;">__SYSTEM_NAME__</p></td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`

// buildEmailHTML 把业务内容包进统一外壳。
func buildEmailHTML(content string) string {
	systemName := html.EscapeString(SystemName)
	return strings.NewReplacer(
		"__SYSTEM_NAME__", systemName,
		"__FONT_STACK__", emailFontStack,
		"__LOGO_CID__", emailLogoContentID,
		"__CONTENT__", content,
		"__CANVAS__", emailColorCanvas,
		"__ACCENT__", emailColorAccent,
		"__INK__", emailColorInk,
	).Replace(emailShellTemplate)
}

// EmailHeading 渲染内容区标题。
func EmailHeading(text string) string {
	return `<h1 style="margin:0 0 12px;font-size:21px;line-height:1.45;font-weight:700;color:` + emailColorInk + `;letter-spacing:-.3px;">` + text + `</h1>`
}

// EmailParagraph 渲染正文段落。text 允许内联标签（如 <strong>），调用方负责其中的动态内容安全。
func EmailParagraph(text string) string {
	return `<p style="margin:0 0 20px;font-size:15px;line-height:1.75;color:` + emailColorBody + `;">` + text + `</p>`
}

// EmailNote 渲染小号提示文字，用于有效期、忽略说明等次要信息。text 允许内联标签。
func EmailNote(text string) string {
	return `<p style="margin:0 0 18px;font-size:13.5px;line-height:1.75;color:` + emailColorMuted + `;">` + text + `</p>`
}

// EmailButton 渲染主操作按钮。深棕底配主黄文字是品牌色里对比度最高的组合，
// 「黄底白字」只有 1.9:1，在手机上基本不可读，不要那样用。
func EmailButton(label string, url string) string {
	return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:0 0 22px 0;">` +
		`<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
		`<td align="center" bgcolor="` + emailColorInk + `" style="border-radius:10px;">` +
		`<a href="` + html.EscapeString(url) + `" style="display:inline-block;padding:15px 38px;font-family:` + emailFontStack + `;font-size:15px;font-weight:700;color:` + emailColorAccent + `;text-decoration:none;border-radius:10px;letter-spacing:.3px;">` + html.EscapeString(label) + `</a>` +
		`</td></tr></table>` +
		`</td></tr></table>`
}

// EmailCodeBlock 渲染大号验证码，等宽数字便于逐位抄写。
// 尺寸受 TestEmailCodeBlockFitsNarrowPhone 约束：这是全邮件最宽的元素，
// 放大字号或字距前先确认它仍能放进窄屏。
func EmailCodeBlock(code string) string {
	return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:2px 0 22px 0;">` +
		`<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
		`<td align="center" bgcolor="#FFF7DE" style="border:1px solid #FBE08A;border-radius:12px;padding:15px 20px;">` +
		`<span style="font-family:Menlo,Consolas,'Courier New',monospace;font-size:31px;line-height:1;font-weight:700;letter-spacing:6px;color:` + emailColorInk + `;">` + html.EscapeString(code) + `</span>` +
		`</td></tr></table>` +
		`</td></tr></table>`
}

// EmailFallbackLink 渲染供手动复制的备用链接。按钮在部分客户端里可能被拦截，
// 因此每封带按钮的邮件都该在按钮下方附上它。
func EmailFallbackLink(url string) string {
	return `<p style="margin:0 0 18px;font-size:13px;line-height:1.7;color:` + emailColorMuted + `;">按钮无法点击？复制下面的链接到浏览器打开：<br><span style="word-break:break-all;font-family:Menlo,Consolas,'Courier New',monospace;color:#8A7A66;">` + html.EscapeString(url) + `</span></p>`
}

// EmailStatBlock 渲染一个突出的统计数值，用于余额、剩余额度这类关键数字。
func EmailStatBlock(label string, value string) string {
	return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:0 0 20px 0;">` +
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFF7DE" style="background-color:#FFF7DE;border:1px solid #FBE08A;border-radius:12px;">` +
		`<tr><td align="center" style="padding:16px 20px;">` +
		`<p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:` + emailColorMuted + `;">` + html.EscapeString(label) + `</p>` +
		`<p style="margin:0;font-size:29px;line-height:1.2;font-weight:700;color:` + emailColorInk + `;">` + html.EscapeString(value) + `</p>` +
		`</td></tr></table>` +
		`</td></tr></table>`
}

// EmailInfoTable 渲染字段表，把一组键值对排成可快速扫读的列表。
func EmailInfoTable(rows [][2]string) string {
	var b strings.Builder
	b.WriteString(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:0 0 22px 0;">`)
	b.WriteString(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #EFE6D6;border-radius:10px;">`)
	for i, row := range rows {
		divider := ""
		if i < len(rows)-1 {
			divider = "border-bottom:1px solid #F2EBDD;"
		}
		b.WriteString(`<tr>` +
			`<td style="padding:11px 16px;font-size:13.5px;color:` + emailColorMuted + `;width:80px;` + divider + `">` + html.EscapeString(row[0]) + `</td>` +
			`<td style="padding:11px 16px;font-size:14px;color:#3D2E1E;` + divider + `">` + html.EscapeString(row[1]) + `</td>` +
			`</tr>`)
	}
	b.WriteString(`</table>`)
	b.WriteString(`</td></tr></table>`)
	return b.String()
}
