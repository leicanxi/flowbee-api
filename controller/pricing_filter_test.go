package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
)

func TestFilterPricingByUsableGroupsTrimsHiddenGroups(t *testing.T) {
	pricing := []model.Pricing{
		{ModelName: "gpt-4o", EnableGroup: []string{"default", "vip", "福利"}},
	}

	got := filterPricingByUsableGroups(pricing, map[string]string{
		"default": "默认分组",
		"vip":     "VIP分组",
	})

	assert.Len(t, got, 1)
	assert.Equal(t, "gpt-4o", got[0].ModelName)
	assert.Equal(t, []string{"default", "vip"}, got[0].EnableGroup)
}

func TestFilterPricingByUsableGroupsDropsModelsWithoutUsableGroup(t *testing.T) {
	pricing := []model.Pricing{
		{ModelName: "hidden-only", EnableGroup: []string{"福利"}},
		{ModelName: "shared", EnableGroup: []string{"福利", "default"}},
	}

	got := filterPricingByUsableGroups(pricing, map[string]string{"default": "默认分组"})

	assert.Len(t, got, 1)
	assert.Equal(t, "shared", got[0].ModelName)
	assert.Equal(t, []string{"default"}, got[0].EnableGroup)
}

func TestFilterPricingByUsableGroupsExpandsAllGroup(t *testing.T) {
	pricing := []model.Pricing{
		{ModelName: "everyone", EnableGroup: []string{"all"}},
	}

	got := filterPricingByUsableGroups(pricing, map[string]string{
		"default": "默认分组",
		"vip":     "VIP分组",
		"auto":    "自动",
	})

	assert.Len(t, got, 1)
	assert.ElementsMatch(t, []string{"default", "vip"}, got[0].EnableGroup)
}

func TestFilterPricingByUsableGroupsWithoutUsableGroupReturnsNothing(t *testing.T) {
	pricing := []model.Pricing{
		{ModelName: "gpt-4o", EnableGroup: []string{"default"}},
	}

	assert.Empty(t, filterPricingByUsableGroups(pricing, map[string]string{}))
}

func TestFilterPricingByUsableGroupsKeepsCachedPricingIntact(t *testing.T) {
	pricing := []model.Pricing{
		{ModelName: "gpt-4o", EnableGroup: []string{"default", "福利"}},
		{ModelName: "everyone", EnableGroup: []string{"all"}},
	}

	filterPricingByUsableGroups(pricing, map[string]string{"default": "默认分组"})

	assert.Equal(t, []string{"default", "福利"}, pricing[0].EnableGroup)
	assert.Equal(t, []string{"all"}, pricing[1].EnableGroup)
}
