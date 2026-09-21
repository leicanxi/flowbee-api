package middleware

import (
	"strings"
	"testing"
)

// 余额分档的 429 文案有三个约束：不回显具体次数、能指向「提升余额」这个
// 唯一有效动作、用户已在最高档时不许再承诺升级（否则等于让用户白充值）。
func TestOverLimitMessageForBalanceTier(t *testing.T) {
	digits := "0123456789"

	upgradable := overLimitMessage(rateLimitParams{balanceTier: true}, false)
	if strings.ContainsAny(upgradable, digits) {
		t.Fatalf("balance tier message must not expose request counts: %q", upgradable)
	}
	if !strings.Contains(upgradable, "提升余额") {
		t.Fatalf("upgradable tier message should point at raising the balance: %q", upgradable)
	}
	// 非顶档同样要给 auto 出口：它是唯一不花钱、立刻可用的动作，只给「提升余额」
	// 等于把当下就能用的那条藏起来。
	if !strings.Contains(upgradable, "auto") {
		t.Fatalf("upgradable tier message should offer the auto-group fallback: %q", upgradable)
	}

	topTier := overLimitMessage(rateLimitParams{balanceTier: true, atTopTier: true}, false)
	if strings.ContainsAny(topTier, digits) {
		t.Fatalf("top tier message must not expose request counts: %q", topTier)
	}
	if strings.Contains(topTier, "提升余额") {
		t.Fatalf("top tier message must not promise an upgrade that does not exist: %q", topTier)
	}
	// 顶档唯一的即时出路是改用 auto 分组令牌（被限速的分组会被跳过），
	// 所以文案必须把它给出来，否则用户只剩「等着」这一个选择。
	if !strings.Contains(topTier, "auto") {
		t.Fatalf("top tier message should offer the auto-group fallback: %q", topTier)
	}
}

// 余额低于最低档是这类用户看到的第一条信息（早于任何一次成功调用），
// 因此它必须自己把「免费模型额度按余额分档」讲清楚，并给出用户手上真正有的
// 两个动作：充值、更换其他分组。它同样不得回显具体次数。
func TestBelowMinimumMessage(t *testing.T) {
	if !strings.Contains(belowMinimumMessage, "按余额分档") {
		t.Fatalf("message should explain that the free quota is tiered by balance: %q", belowMinimumMessage)
	}
	if !strings.Contains(belowMinimumMessage, "充值") {
		t.Fatalf("message should point at topping up the balance: %q", belowMinimumMessage)
	}
	if !strings.Contains(belowMinimumMessage, "更换其他分组") {
		t.Fatalf("message should offer switching to another group: %q", belowMinimumMessage)
	}
	if strings.ContainsAny(belowMinimumMessage, "0123456789") {
		t.Fatalf("message must not expose request counts: %q", belowMinimumMessage)
	}
}

// 非余额分档（全局限额、分组固定限速）的额度与余额无关，保留原始文案：
// 这类场景告诉用户具体次数才有意义，用户需要据此判断重试节奏。
func TestOverLimitMessageForFixedLimits(t *testing.T) {
	successLimit := overLimitMessage(rateLimitParams{successMaxCount: 20}, false)
	if !strings.Contains(successLimit, "20") {
		t.Fatalf("fixed success limit should keep the count: %q", successLimit)
	}

	totalLimit := overLimitMessage(rateLimitParams{totalMaxCount: 30}, true)
	if !strings.Contains(totalLimit, "30") || !strings.Contains(totalLimit, "失败") {
		t.Fatalf("fixed total limit should keep the count and the failure hint: %q", totalLimit)
	}
}
