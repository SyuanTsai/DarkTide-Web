-- chunkname: @test/fixtures/talent-layouts/broker_stimm_tree.lua
return {
  archetype_name = "broker",
  name = "broker_stimm_tree",
  background_height = 480,
  version = 2,
  nodes = {
    {
      widget_name = "node_start",
      type = "start",
      talent = "broker_stimm_activation_talent",
      icon = "escaped \"quote\" and \\ -- still a string",
      x = -12.5,
      y = .75, -- a horizontal and vertical offset
      children = { "node_second", "node_removed" },
      requirements = { all_parents_chosen = false, unlocked = true, additional = nil },
    },
    {
      widget_name = "node_second",
      type = "broker_stimm",
      talent = "not_selected",
      x = 30,
      y = -2,
      children = {},
    },
    {
      widget_name = "node_third",
      type = "broker_stimm",
      x = 60,
      y = 7,
      children = {},
    },
  },
} -- end of the layout
