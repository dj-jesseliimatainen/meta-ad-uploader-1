// _meta-uploader-config.js — SINGLE SOURCE OF TRUTH for your standard settings.
//
// SETUP: copy this file to `_meta-uploader-config.js` (same folder) and fill in every value
// marked TODO. Secrets (tokens) do NOT live here — they go in environment variables (see .env.example).
// ESM module — matches the import/export style of the api/*.js handlers.

const OPT_OUT = { enroll_status: 'OPT_OUT' };
const OPT_IN = { enroll_status: 'OPT_IN' };

export default {
  // ---- Graph API ----
  GRAPH_VERSION: 'v22.0',                 // pinned; bump deliberately (~annual). Re-verify enhancement keys on bump.
  AD_ACCOUNT_ID: 'act_TODO',              // TODO your ad account id, with the "act_" prefix

  // ---- Campaigns you pre-create ONCE in Ads Manager; the uploader only ADDS ad sets under them ----
  BUILDER_CAMPAIGN_ID: 'TODO',            // TODO a paused "builder" campaign ("Do Not Turn On")
  TESTING_CAMPAIGN_ID: 'TODO',            // TODO your testing campaign

  // ---- Standard ad-set settings (tune to your account) ----
  adSetDefaults: {
    optimization_goal: 'OFFSITE_CONVERSIONS', // TODO match your objective (e.g. LINK_CLICKS, LEAD_GENERATION)
    billing_event: 'IMPRESSIONS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    daily_budget: 5000,                   // TODO minor units of the AD ACCOUNT's currency (5000 = $50.00 / £50.00 / etc.)
    targeting: {
      age_min: 18,
      age_max: 65,
      geo_locations: { countries: ['US'], location_types: ['home', 'recent'] }, // TODO your target countries
      targeting_automation: { advantage_audience: 0 },   // Advantage+ Audience OFF (set 1 to enable)
      // No publisher_platforms set => Advantage+ placements (all placements). Add publisher_platforms to restrict.
    },
    attribution_spec: [
      { event_type: 'CLICK_THROUGH', window_days: 7 },
      { event_type: 'VIEW_THROUGH', window_days: 1 },
    ],
    promoted_object: { pixel_id: 'TODO', custom_event_type: 'PURCHASE' }, // TODO your Pixel id + conversion event
    status: 'PAUSED',                     // everything is created PAUSED for human review — keep this
  },

  defaultCallToAction: 'LEARN_MORE',      // TODO your default CTA button (SHOP_NOW, SIGN_UP, ...)

  // ---- Tracking params appended to every ad's destination URL (optional; edit or blank out) ----
  // Meta dynamic tokens ({{...}}) resolve per-ad at delivery, so a shared post still gets per-ad ids.
  urlTags: 'h_ad_id={{ad.id}}&fbc_id={{adset.id}}&site_source={{site_source_name}}',

  // ---- Identity map: the Notion "Identity" select value -> Facebook Page id + Instagram user id ----
  // An identity needs BOTH ids; entries missing either fail loudly (won't misfire).
  // For whitelisting/partner pages, your system user must have ADVERTISE access on that Page.
  // Get page_id: Meta Business Settings > Pages. Get instagram_user_id via the Graph API (see SETUP.md).
  identities: {
    'My Brand': { page_id: 'TODO', instagram_user_id: 'TODO' }, // TODO your own Page + IG
    // 'WL - Partner Name': { page_id: 'TODO', instagram_user_id: 'TODO' }, // whitelisting partner (optional)
  },

  // ---- Advantage+ creative enhancements ----
  // Everything OFF by default except four commonly-wanted ones. Verify keys against your live account on
  // each Graph version bump (this is the highest-churn area of the API). See SETUP.md "verify enhancement keys".
  creativeEnhancements: {
    degrees_of_freedom_spec: {
      creative_features_spec: {
        adapt_to_placement: OPT_OUT,
        add_text_overlay: OPT_OUT,
        creative_stickers: OPT_OUT,
        description_automation: OPT_OUT,
        enhance_cta: OPT_IN,             // "Enhance CTA"
        image_animation: OPT_OUT,
        image_background_gen: OPT_OUT,
        image_templates: OPT_OUT,
        image_touchups: OPT_OUT,
        image_uncrop: OPT_IN,            // "Expand image"
        inline_comment: OPT_IN,          // "Relevant comments"
        media_type_automation: OPT_OUT,
        music_generation: OPT_OUT,
        pac_relaxation: OPT_OUT,
        product_extensions: OPT_OUT,
        profile_card: OPT_OUT,
        reveal_details_over_time: OPT_OUT,
        show_destination_blurbs: OPT_OUT,
        show_summary: OPT_OUT,
        site_extensions: OPT_OUT,
        text_optimizations: OPT_IN,      // "Text improvements"
        text_translation: OPT_OUT,
        translate_voiceover: OPT_OUT,
        video_auto_crop: OPT_OUT,
        video_highlights: OPT_OUT,
      },
    },
    contextual_multi_ads: OPT_OUT,
  },

  // ---- Frame.io (V4 via Adobe IMS; access token minted from a refresh token at runtime) ----
  FRAMEIO_API_VERSION: 'v4',
  FRAMEIO_ACCOUNT_ID: process.env.FRAMEIO_ACCOUNT_ID || 'TODO', // TODO your Frame.io V4 account id

  // ---- Filename -> variation convention ("Var 1", "V2", etc.) ----
  variationRegex: /\b(?:var(?:iation)?|v)\s*[-_]?\s*(\d+)\b/i,
};
