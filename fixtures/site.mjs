// Entirely fictional content for local layout and contract verification.
export const fixture = {
  schema_version: 1,
  package_kind: 'fixture',
  taxonomy_version: 'demo-v1',
  skills: [{
    schema_version: 1,
    archetype: 'veteran',
    skill_id: 'practice-guard',
    kind: 'current-talent',
    category: '示範分類',
    name_zh_tw: '演示防護',
    effect_zh_tw: '這是一段虛構技能效果，僅用於版面測試。',
    mechanics_zh_tw: '這是一段虛構機制說明，僅用於版面測試。',
    claims: [], evidence: [], asset_ids: []
  }],
  weapons: [{
    schema_version: 1,
    weapon_id: 'practice-rifle',
    kind: 'ranged',
    name_zh_tw: '演示步槍',
    model_zh_tw: null,
    mark_ids: ['practice-rifle-m1'],
    claims: [], evidence: [], asset_ids: []
  }],
  marks: [{
    schema_version: 1,
    mark_id: 'practice-rifle-m1',
    weapon_id: 'practice-rifle',
    template_source_id: 'fixture-source',
    name_zh_tw: '演示型',
    claims: [], evidence: [], asset_ids: []
  }],
  blessings: [{
    schema_version: 1,
    blessing_id: 'steady-example',
    name_zh_tw: '演示穩定',
    effect_zh_tw: '這是一段虛構祝福效果，僅用於版面測試。',
    trigger_zh_tw: null,
    variant_ids: ['steady-example-rifle'],
    evidence: [], asset_ids: []
  }],
  variants: [{
    schema_version: 1,
    variant_id: 'steady-example-rifle',
    blessing_id: 'steady-example',
    weapon_id: 'practice-rifle',
    defined_tiers: [1],
    available_tiers: null,
    tier_claims: [], evidence: [], asset_ids: []
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
  routes: [
    { route_kind: 'canonical', content_kind: 'skill', content_key: 'veteran/practice-guard', source_route: null, target_route: '/skills/veteran/practice-guard/', decision: 'keep' },
    { route_kind: 'canonical', content_kind: 'weapon', content_key: 'practice-rifle', source_route: null, target_route: '/weapons/practice-rifle/', decision: 'keep' },
    { route_kind: 'canonical', content_kind: 'mark', content_key: 'practice-rifle-m1', source_route: null, target_route: '/weapons/practice-rifle/marks/practice-rifle-m1/', decision: 'keep' },
    { route_kind: 'canonical', content_kind: 'blessing', content_key: 'steady-example', source_route: null, target_route: '/blessings/steady-example/', decision: 'keep' },
    { route_kind: 'canonical', content_kind: 'variant', content_key: 'steady-example-rifle', source_route: null, target_route: '/blessings/steady-example/variants/steady-example-rifle/', decision: 'keep' }
  ],
  assets: []
};
