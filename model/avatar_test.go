package model

import (
	"strings"
	"testing"
)

// 改造#40 单测：头像推导、token 签名、偏好开关判定。
// 这三个函数都是纯函数，不碰数据库，所以这里不需要任何测试基建。

func TestAccountAvatarURL(t *testing.T) {
	cases := []struct {
		name     string
		email    string
		githubId string
		want     string
	}{
		{"QQ 邮箱取数字前缀", "10000@qq.com", "", "https://q1.qlogo.cn/g?b=qq&nk=10000&s=160"},
		{"foxmail 同样适用", "123456789@foxmail.com", "", "https://q1.qlogo.cn/g?b=qq&nk=123456789&s=160"},
		{"vip.qq.com 同样适用", "10000@vip.qq.com", "", "https://q1.qlogo.cn/g?b=qq&nk=10000&s=160"},
		{"域名大小写不敏感", "10000@QQ.com", "", "https://q1.qlogo.cn/g?b=qq&nk=10000&s=160"},
		{"首尾空格被裁掉", "  10000@qq.com  ", "", "https://q1.qlogo.cn/g?b=qq&nk=10000&s=160"},
		{"字母别名的 QQ 邮箱不匹配", "abc@qq.com", "", ""},
		{"位数不足不匹配", "1234@qq.com", "", ""},
		{"位数超限不匹配", "123456789012@qq.com", "", ""},
		{"QQ 邮箱优先于 GitHub", "10000@qq.com", "42", "https://q1.qlogo.cn/g?b=qq&nk=10000&s=160"},
		{"GitHub 数字 id", "", "42", "https://avatars.githubusercontent.com/u/42?s=160"},
		{"GitHub 非数字 login 不匹配", "", "octocat", ""},
		{"两者都空", "", "", ""},
		{"非 QQ 邮箱且无 GitHub", "me@gmail.com", "", ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := accountAvatarURL(tc.email, tc.githubId); got != tc.want {
				t.Fatalf("accountAvatarURL(%q, %q) = %q, want %q", tc.email, tc.githubId, got, tc.want)
			}
		})
	}
}

func TestAvatarTokenRoundTrip(t *testing.T) {
	for _, userId := range []int{1, 42, 99999} {
		token := avatarToken(userId)
		got, ok := ParseAvatarToken(token)
		if !ok {
			t.Fatalf("avatarToken(%d) = %q，回解却验签失败", userId, token)
		}
		if got != userId {
			t.Fatalf("avatarToken(%d) 回解得到 %d", userId, got)
		}
	}
}

func TestAvatarTokenHidesUserIdWithoutSignature(t *testing.T) {
	// token 必须带签名段，否则代理接口就成了「改个数字就能拉全站头像」。
	token := avatarToken(42)
	idPart, sig, found := strings.Cut(token, ".")
	if !found || idPart != "42" || sig == "" {
		t.Fatalf("token 结构不符合 <id>.<sig>：%q", token)
	}
	if len(sig) != 16 {
		t.Fatalf("签名长度应为 16，实际 %d", len(sig))
	}
}

func TestParseAvatarTokenRejects(t *testing.T) {
	valid := avatarToken(42)
	_, validSig, _ := strings.Cut(valid, ".")

	cases := []struct {
		name  string
		token string
	}{
		{"空字符串", ""},
		{"没有签名段", "42"},
		{"签名段为空", "42."},
		{"id 段为空", "." + validSig},
		{"id 不是数字", "abc." + validSig},
		{"id 是 0", "0." + validSig},
		{"id 是负数", "-1." + validSig},
		{"签名全错", "42.0000000000000000"},
		{"签名被截短", "42." + validSig[:8]},
		{"改了 id 但沿用别人的签名", "43." + validSig},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if userId, ok := ParseAvatarToken(tc.token); ok {
				t.Fatalf("ParseAvatarToken(%q) 竟然通过了，解出 userId=%d", tc.token, userId)
			}
		})
	}
}

func TestIsAccountAvatarDisabled(t *testing.T) {
	cases := []struct {
		name    string
		setting string
		want    bool
	}{
		{"空 setting 视为启用", "", false},
		{"没有这个键视为启用", `{"notify_type":"email"}`, false},
		{"显式 oauth 视为启用", `{"avatar_preference":"oauth"}`, false},
		{"显式 default 视为关闭", `{"avatar_preference":"default"}`, true},
		{"大小写敏感，DEFAULT 不算数", `{"avatar_preference":"DEFAULT"}`, false},
		{"非法 JSON 按启用处理而不是报错", `{`, false},
		{"纯空白按空处理", "   ", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isAccountAvatarDisabled(tc.setting); got != tc.want {
				t.Fatalf("isAccountAvatarDisabled(%q) = %v, want %v", tc.setting, got, tc.want)
			}
		})
	}
}
