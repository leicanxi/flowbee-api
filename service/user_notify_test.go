package service

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPlainTextNotifyContentStripsEmailMarkup(t *testing.T) {
	content := `<h1 style="color:#4C2F1B;">通道已被禁用</h1>` +
		`<p style="margin:0 0 20px;">自动巡检发现通道异常，已停止向其调度请求：</p>` +
		`<table role="presentation"><tr><td>通道名称</td><td>b.ai</td></tr><tr><td>禁用原因</td><td>401 &amp; 额度耗尽</td></tr></table>` +
		`<p style="margin:0;">请及时处理。</p>`

	out := plainTextNotifyContent(content)

	// Bark / Gotify 按纯文本渲染，不能再出现任何标签或内联样式。
	require.NotContains(t, out, "<")
	require.NotContains(t, out, "style=")
	require.NotContains(t, out, "role=")

	require.Equal(t,
		"通道已被禁用\n"+
			"自动巡检发现通道异常，已停止向其调度请求：\n"+
			"通道名称 b.ai\n"+
			"禁用原因 401 & 额度耗尽\n"+
			"请及时处理。",
		out,
	)
}

func TestPlainTextNotifyContentLeavesPlainTextUntouched(t *testing.T) {
	content := "{{value}}，剩余额度：{{value}}，请及时充值"
	require.Equal(t, content, plainTextNotifyContent(content))
}

func TestPlainTextNotifyContentKeepsLiteralLessThan(t *testing.T) {
	// 正文里正常的小于号不能被当成标签起始符，连带吞掉后面的文字。
	require.Equal(t, "当前倍率 < 0.5，请注意", plainTextNotifyContent("当前倍率 < 0.5，请注意"))
}
