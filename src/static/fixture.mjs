export function fixturePublicContent() {
  return {
    schema_version: 2,
    package_kind: 'fixture',
    game_version: 'fixture',
    skills: [{
      archetype: 'veteran',
      skill_id: 'practice-guard',
      kind: 'current-talent',
      category: '示範技能',
      name_zh_tw: '演示防護',
      effect_zh_tw: '這是一段虛構技能效果，僅用於版面與建置測試。',
      mechanics_zh_tw: '這是一段虛構機制說明，僅用於版面與建置測試。',
      claims: [],
      asset_ids: [],
      source_ids: []
    }],
    weapons: [{
      weapon_id: 'practice-rifle',
      kind: 'ranged',
      category: '遠程武器',
      name_zh_tw: '演示步槍',
      model_zh_tw: null,
      mark_ids: ['practice-rifle-m1'],
      claims: [],
      asset_ids: [],
      source_ids: []
    }],
    marks: [{
      mark_id: 'practice-rifle-m1',
      weapon_id: 'practice-rifle',
      category: '示範型號',
      name_zh_tw: '演示型',
      claims: [],
      asset_ids: [],
      source_ids: []
    }],
    blessings: [{
      blessing_id: 'steady-example',
      category: '示範祝福',
      name_zh_tw: '演示穩定',
      effect_zh_tw: '這是一段虛構祝福效果，僅用於建置測試。',
      trigger_zh_tw: null,
      variant_ids: ['steady-example-rifle'],
      asset_ids: [],
      source_ids: []
    }],
    variants: [{
      variant_id: 'steady-example-rifle',
      blessing_id: 'steady-example',
      weapon_id: 'practice-rifle',
      category: '示範變體',
      defined_tiers: [1],
      available_tiers: null,
      tier_claims: [],
      asset_ids: [],
      source_ids: []
    }],
    bindings: [{
      blessing_id: 'steady-example',
      weapon_id: 'practice-rifle',
      mark_id: 'practice-rifle-m1',
      variant_id: 'steady-example-rifle',
      trait_item: null,
      trait_category: null,
      available_tiers: null
    }],
    assets: [],
    routes: [
      {
        route_kind: 'canonical',
        content_kind: 'skill',
        content_key: 'veteran/practice-guard',
        source_route: null,
        target_route: '/skills/veteran/practice-guard/',
        decision: 'keep'
      },
      {
        route_kind: 'canonical',
        content_kind: 'weapon',
        content_key: 'practice-rifle',
        source_route: null,
        target_route: '/weapons/practice-rifle/',
        decision: 'keep'
      },
      {
        route_kind: 'canonical',
        content_kind: 'mark',
        content_key: 'practice-rifle-m1',
        source_route: null,
        target_route: '/weapons/practice-rifle/marks/practice-rifle-m1/',
        decision: 'keep'
      },
      {
        route_kind: 'canonical',
        content_kind: 'blessing',
        content_key: 'steady-example',
        source_route: null,
        target_route: '/blessings/steady-example/',
        decision: 'keep'
      },
      {
        route_kind: 'canonical',
        content_kind: 'variant',
        content_key: 'steady-example-rifle',
        source_route: null,
        target_route: '/blessings/steady-example/variants/steady-example-rifle/',
        decision: 'keep'
      }
    ],
    sources: []
  };
}

