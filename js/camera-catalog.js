// ---------- Catálogo de cámaras: cuerpos, modos de grabación y área de sensor que cubre el plate ----------
// Datos de DepthLab (resources/data/camera_catalog.json, fuentes y dudas en Design/CarGS/ allá) más los
// presets de 3D Camera Pin que DepthLab no tiene (al final). Modo: [id, label, fotositos W, H, mm W, H,
// pitch µm, confianza]; fotositos 0 = el fabricante no los publica (no se puede extraer ni reconocer el raster).
const CAM_CATALOG = [
  { id: "arri_alexa35", make: "ARRI", model: "ALEXA 35", names: ["ARRI ALEXA 35","ALEXA 35"], modes: [
    ["a35_46k_og", "4.6K 3:2 Open Gate", 4608, 3164, 27.99, 19.22, 6.075, "official"],
    ["a35_46k_169", "4.6K 16:9", 4608, 2592, 27.99, 15.75, 6.075, "official"],
    ["a35_4k_169", "4K 16:9", 4096, 2304, 24.88, 14, 6.075, "official"],
    ["a35_4k_21", "4K 2:1", 4096, 2048, 24.88, 12.44, 6.075, "official"],
    ["a35_38k_169", "3.8K 16:9 (UHD)", 3840, 2160, 23.33, 13.12, 6.075, "official"],
    ["a35_33k_65", "3.3K 6:5", 3328, 2790, 20.22, 16.95, 6.075, "official"],
    ["a35_3k_11", "3K 1:1", 3072, 3072, 18.66, 18.66, 6.075, "official"],
    ["a35_27k_89", "2.7K 8:9", 2743, 3086, 16.66, 18.75, 6.075, "official"],
    ["a35_2k_s16", "2K 16:9 S16", 2048, 1152, 12.44, 7, 6.075, "official"],
  ] },
  { id: "arri_alexa35_xtreme", make: "ARRI", model: "ALEXA 35 Xtreme", names: ["ALEXA 35 Xtreme","ARRI ALEXA 35 Xtreme"], modes: [
    ["a35x_46k_og", "4.6K 3:2 Open Gate", 4608, 3164, 27.99, 19.22, 6.075, "official"],
    ["a35x_46k_169", "4.6K 16:9", 4608, 2592, 27.99, 15.75, 6.075, "official"],
    ["a35x_4k_169", "4K 16:9", 4096, 2304, 24.88, 14, 6.075, "official"],
    ["a35x_38k_169", "3.8K 16:9", 3840, 2160, 23.33, 13.12, 6.075, "official"],
    ["a35x_38k_239", "3.8K 2.39:1", 3840, 1608, 23.33, 9.77, 6.075, "official"],
    ["a35x_33k_65", "3.3K 6:5", 3328, 2790, 20.22, 16.95, 6.075, "official"],
    ["a35x_2k_s16", "2K 16:9 S16", 2048, 1152, 12.44, 7, 6.075, "official"],
    ["a35x_hd_s16", "HD 16:9 S16", 1920, 1080, 11.66, 6.56, 6.075, "official"],
  ] },
  { id: "arri_alexa265", make: "ARRI", model: "ALEXA 265", names: ["ALEXA 265"], modes: [
    ["a265_65k_og", "6.5K 2.12:1 Open Gate", 6560, 3100, 54.12, 25.58, 8.25, "official"],
    ["a265_51k", "5.1K 1.65:1", 5120, 3100, 42.24, 25.58, 8.25, "official"],
    ["a265_45k_lf", "4.5K LF 3:2", 4448, 3096, 36.7, 25.54, 8.25, "official"],
  ] },
  { id: "arri_alexa65", make: "ARRI", model: "ALEXA 65", names: ["ALEXA 65"], modes: [
    ["a65_og", "Open Gate 6.5K", 6560, 3100, 54.12, 25.58, 8.25, "official"],
    ["a65_51k", "5.1K (16:9)", 5120, 2880, 42.24, 23.76, 8.25, "official"],
    ["a65_43k", "4.3K (3:2)", 4320, 2880, 35.64, 23.76, 8.25, "official"],
    ["a65_lf_og", "LF Open Gate", 4448, 3096, 36.7, 25.54, 8.25, "official"],
  ] },
  { id: "arri_alexa_mini_lf", make: "ARRI", model: "ALEXA Mini LF", names: ["ALEXA Mini LF"], modes: [
    ["mlf_45k_og", "4.5K LF 3:2 Open Gate", 4448, 3096, 36.7, 25.54, 8.25, "official"],
    ["mlf_45k_239", "4.5K LF 2.39:1", 4448, 1856, 36.7, 15.31, 8.25, "official"],
    ["mlf_43k_169", "4.3K LF 16:9 (UHD/HD)", 4320, 2430, 35.64, 20.05, 8.25, "official"],
    ["mlf_38k_169", "3.8K LF 16:9 (UHD)", 3840, 2160, 31.68, 17.82, 8.25, "official"],
    ["mlf_28k_11", "2.8K LF 1:1", 2880, 2880, 23.76, 23.76, 8.25, "official"],
    ["mlf_34k_s35_32", "3.4K S35 3:2", 3424, 2202, 28.25, 18.16, 8.25, "official"],
    ["mlf_32k_s35_169", "3.2K S35 16:9", 3200, 1800, 26.4, 14.85, 8.25, "official"],
    ["mlf_28k_s35_43", "2.8K S35 4:3", 2880, 2160, 23.76, 17.81, 8.25, "official"],
    ["mlf_28k_s35_169", "2.8K S35 16:9 (HD)", 2880, 1620, 23.76, 13.36, 8.25, "official"],
  ] },
  { id: "arri_alexa_lf", make: "ARRI", model: "ALEXA LF", names: ["ALEXA LF"], modes: [
    ["lf_og", "LF Open Gate 4.5K", 4448, 3096, 36.7, 25.54, 8.25, "official"],
    ["lf_169", "LF 16:9 (UHD)", 3840, 2160, 31.68, 17.82, 8.25, "official"],
    ["lf_239", "LF 2.39:1 (Scope 4.5K)", 4448, 1856, 36.7, 15.31, 8.25, "official"],
  ] },
  { id: "arri_alexa_mini", make: "ARRI", model: "ALEXA Mini", names: ["ALEXA Mini"], modes: [
    ["mini_og_34k", "Open Gate 3.4K", 3424, 2202, 28.25, 18.17, 8.25, "official"],
    ["mini_43_28k", "4:3 2.8K", 2880, 2160, 23.76, 17.82, 8.25, "official"],
    ["mini_169_32k", "16:9 3.2K / 4K UHD", 3200, 1800, 26.4, 14.85, 8.25, "official"],
    ["mini_169_hd", "16:9 HD / 2.8K", 2880, 1620, 23.76, 13.37, 8.25, "official"],
    ["mini_169_2k", "16:9 2K", 2868, 1612, 23.66, 13.3, 8.25, "official"],
    ["mini_s16_hd", "S16 HD", 1600, 900, 13.2, 7.425, 8.25, "official"],
    ["mini_239_2k_ana", "2.39:1 2K Ana (6:5)", 2560, 2145, 21.12, 17.7, 8.25, "official"],
    ["mini_hd_ana", "HD Ana (16:9 Ana 2x)", 1920, 2160, 15.84, 17.82, 8.25, "official"],
  ] },
  { id: "arri_amira", make: "ARRI", model: "AMIRA", names: ["AMIRA"], modes: [
    ["amira_169_32k", "16:9 3.2K / 4K UHD", 3200, 1800, 26.4, 14.85, 8.25, "official"],
    ["amira_169_hd", "16:9 HD / 2.8K", 2880, 1620, 23.76, 13.37, 8.25, "official"],
    ["amira_169_2k", "16:9 2K", 2868, 1612, 23.66, 13.3, 8.25, "official"],
    ["amira_s16_hd", "S16 HD", 1600, 900, 13.2, 7.425, 8.25, "official"],
  ] },
  { id: "arri_alexa_sxt", make: "ARRI", model: "ALEXA SXT", names: ["ALEXA SXT","ALEXA SXT W","ALEXA SXT Plus","ALEXA SXT Studio"], modes: [
    ["sxt_og_34k", "Open Gate 3.4K", 3424, 2202, 28.25, 18.17, 8.25, "official"],
    ["sxt_og_4kcine", "Open Gate 4K Cine", 3414, 2198, 28.17, 18.13, 8.25, "official"],
    ["sxt_43_28k", "4:3 2.8K", 2880, 2160, 23.76, 17.82, 8.25, "official"],
    ["sxt_65_26k", "6:5 2.6K (ARRIRAW)", 2592, 2160, 21.38, 17.82, 8.25, "official"],
    ["sxt_65_ana_prores", "6:5 2K/4K Cine Anamorphic (ProRes)", 2560, 2146, 21.12, 17.7, 8.25, "official"],
    ["sxt_169_32k", "16:9 3.2K / 4K UHD (ProRes)", 3200, 1800, 26.4, 14.85, 8.25, "official"],
    ["sxt_169_32k_raw", "16:9 3.2K (ARRIRAW)", 3168, 1782, 26.14, 14.7, 8.25, "official"],
    ["sxt_169_hd", "16:9 HD / 2K / 2.8K", 2880, 1620, 23.76, 13.37, 8.25, "official"],
  ] },
  { id: "arri_alexa_xt_classic", make: "ARRI", model: "ALEXA XT / Classic", names: ["ALEXA XT","ALEXA XT Plus","ALEXA XT Studio","ALEXA XT M","ALEXA","ALEXA Plus","ALEXA Studio","ALEXA M"], modes: [
    ["xt_og", "Open Gate (ARRIRAW, XT only)", 3424, 2202, 28.25, 18.17, 8.25, "official"],
    ["xt_43_full", "4:3 Full 2.8K (ARRIRAW)", 2880, 2160, 23.76, 17.82, 8.25, "official"],
    ["xt_43_cropped", "4:3 Cropped (ARRIRAW)", 2578, 2160, 21.27, 17.82, 8.25, "official"],
    ["xt_43_2k_prores", "4:3 2K (ProRes)", 2868, 2152, 23.66, 17.75, 8.25, "official"],
    ["xt_169_32k", "16:9 3.2K (ProRes)", 3168, 1782, 26.14, 14.7, 8.25, "official"],
    ["xt_169_hd", "16:9 HD / ARRIRAW 2.8K", 2880, 1620, 23.76, 13.37, 8.25, "official"],
    ["xt_169_2k", "16:9 2K (ProRes)", 2868, 1614, 23.66, 13.32, 8.25, "official"],
  ] },
  { id: "sony_venice2_86k", make: "Sony", model: "VENICE 2 8.6K", names: ["MPC-3628","VENICE 2"], modes: [
    ["v2_86k_32", "8.6K 3:2 FF", 8640, 5760, 35.9, 24, 4.155, "official"],
    ["v2_86k_179", "8.6K 17:9 FF", 8640, 4556, 35.9, 19, 4.155, "official"],
    ["v2_82k_179", "8.2K 17:9 FF", 8192, 4320, 34.1, 18, 4.155, "official"],
    ["v2_82k_239", "8.2K 2.39:1 FF", 8192, 3432, 34.1, 14.3, 4.155, "official"],
    ["v2_81k_169", "8.1K 16:9 FF", 8100, 4556, 33.7, 19, 4.155, "official"],
    ["v2_76k_169", "7.6K 16:9 FF", 7680, 4320, 31.9, 18, 4.155, "official"],
    ["v2_58k_65", "5.8K 6:5 S35 (anamorphic)", 5792, 4854, 24.1, 20.2, 4.155, "official"],
    ["v2_58k_43", "5.8K 4:3 S35", 5792, 4276, 24.1, 17.8, 4.155, "official"],
    ["v2_58k_179", "5.8K 17:9 S35", 5792, 3056, 24.1, 12.7, 4.155, "official"],
    ["v2_55k_239", "5.5K 2.39:1 S35", 5480, 2296, 22.8, 9.6, 4.155, "official"],
    ["v2_54k_169", "5.4K 16:9 S35", 5434, 3056, 22.6, 12.7, 4.155, "official"],
  ] },
  { id: "sony_venice_6k", make: "Sony", model: "VENICE / VENICE 2 6K", names: ["MPC-3610","MPC-3626","VENICE"], modes: [
    ["v6k_6k_32", "6K 3:2 FF", 6048, 4032, 35.9, 24, 5.94, "official"],
    ["v6k_6k_185", "6K 1.85:1 FF", 6054, 3272, 36, 19.4, 5.94, "official"],
    ["v6k_6k_179", "6K 17:9 FF", 6054, 3192, 36, 19, 5.94, "official"],
    ["v6k_6k_239", "6K 2.39:1 FF", 6048, 2534, 35.9, 15, 5.94, "official"],
    ["v6k_57k_169", "5.7K 16:9 FF", 5674, 3192, 33.7, 19, 5.94, "official"],
    ["v6k_4k_65", "4K 6:5 (anamorphic)", 4096, 3432, 24.3, 20.4, 5.94, "official"],
    ["v6k_4k_43", "4K 4:3 (anamorphic)", 4096, 3024, 24.3, 18, 5.94, "official"],
    ["v6k_4k_179", "4K 17:9 S35", 4096, 2160, 24.3, 12.8, 5.94, "official"],
    ["v6k_4k_239", "4K 2.39:1 S35", 4096, 1716, 24.3, 10.3, 5.94, "official"],
    ["v6k_38k_169", "3.8K 16:9 S35", 3840, 2160, 22.8, 12.8, 5.94, "official"],
  ] },
  { id: "sony_burano", make: "Sony", model: "BURANO", names: ["MPC-2610","BURANO"], modes: [
    ["bur_ff86k_169", "FF 8.6K 16:9", 8632, 4856, 35.9, 20.2, 4.159, "official"],
    ["bur_ff86k_179", "FF 8.6K 17:9", 8632, 4552, 35.9, 18.9, 4.159, "official"],
    ["bur_ffc6k_169", "FFc 6K 16:9", 6052, 3404, 33.6, 18.9, 4.159, "official"],
    ["bur_ffc6k_179", "FFc 6K 17:9", 6052, 3192, 33.6, 17.7, 4.159, "official"],
    ["bur_ff58k_65", "FF 5.8K 6:5 (anamorphic)", 5828, 4856, 24.2, 20.2, 4.159, "official"],
    ["bur_ffc38k_169", "FFc 3.8K 16:9", 3840, 2160, 32, 18, 4.159, "official"],
    ["bur_s35_58k_169", "S35 5.8K 16:9", 5760, 3240, 24, 13.5, 4.159, "official"],
    ["bur_s35_58k_179", "S35 5.8K 17:9", 5760, 3036, 24, 12.6, 4.159, "official"],
    ["bur_s35_43k_43", "S35 4.3K 4:3", 4256, 3192, 23.6, 17.7, 4.159, "official"],
    ["bur_s35c_4k_179", "S35c 4K 17:9", 4096, 2160, 17, 9, 4.159, "official"],
    ["bur_s35c_38k_169", "S35c 3.8K 16:9", 3840, 2160, 16, 9, 4.159, "official"],
    ["bur_s35_19k_169", "S35 1.9K 16:9", 1920, 1080, 24, 13.5, 4.159, "official"],
  ] },
  { id: "sony_fx9", make: "Sony", model: "FX9", names: ["PXW-FX9","FX9"], modes: [
    ["fx9_ff6k", "FF 6K (UHD/DCI 4K/HD oversampled)", 6008, 3168, 35.7, 18.8, 5.94, "derived"],
    ["fx9_ffc5k", "FF 5K crop (FW2)", 0, 0, 29.6, 15.6, 5.94, "derived"],
    ["fx9_s35_4k", "S35 4K", 0, 0, 24, 12.7, 5.94, "official"],
    ["fx9_ff2k", "FF 2K (HFR)", 0, 0, 35.7, 18.8, 5.94, "third-party"],
    ["fx9_s35_2k", "S35 2K (HFR)", 0, 0, 24, 12.7, 5.94, "third-party"],
  ] },
  { id: "sony_fx6", make: "Sony", model: "FX6", names: ["ILME-FX6","FX6"], modes: [
    ["fx6_ff_uhd", "FF UHD <=60p (full width)", 4240, 2385, 35.6, 20, 8.4, "derived"],
    ["fx6_s35_hd", "S35 HD (1.5x)", 0, 0, 23.7, 13.3, 8.4, "derived"],
  ] },
  { id: "sony_fx3", make: "Sony", model: "FX3", names: ["ILME-FX3","FX3"], modes: [
    ["fx3_ff_uhd", "FF UHD <=60p", 4240, 2385, 35.6, 20, 8.4, "derived"],
  ] },
  { id: "sony_fx30", make: "Sony", model: "FX30", names: ["ILME-FX30","FX30"], modes: [
    ["fx30_uhd_6k_os", "UHD (6K oversampled)", 6192, 3483, 23.3, 13.1, 3.76, "derived"],
  ] },
  { id: "sony_f55", make: "Sony", model: "F55", names: ["PMW-F55","F55"], modes: [
    ["f55_4k_179", "4K 17:9 (full scan)", 4096, 2160, 24, 12.7, 5.86, "third-party"],
  ] },
  { id: "sony_f65", make: "Sony", model: "F65", names: ["F65"], modes: [
    ["f65_4k_179", "4K 17:9 (F65RAW)", 8192, 2160, 24.7, 13.1, 0, "third-party"],
  ] },
  { id: "generic", make: "Other", model: "Generic formats", names: [], modes: [
    ["generic_ff36", "Full frame 36 x 24 mm", 0, 0, 36, 24, 0, "official"],
    ["generic_s35_4perf", "Super 35 4-perf", 0, 0, 24.89, 18.66, 0, "official"],
  ] },
  { id: "red_vraptor_vv", make: "RED", model: "V-RAPTOR 8K VV", names: ["V-RAPTOR","V-RAPTOR 8K VV"], modes: [
    ["vraptor_8k_vv_179", "8K 17:9 VV", 8192, 4320, 40.96, 21.6, 5, "official"],
  ] },
  // de 3D Camera Pin (Javi): fotositos sacados de los mm y el raster de grabación habitual
  { id: 'red_komodo', make: 'RED', model: 'KOMODO 6K', names: ['KOMODO', 'KOMODO 6K', 'RED KOMODO'], modes: [
    ['komodo_6k_179', '6K 17:9', 6144, 3240, 27.03, 14.26, 4.4, 'derived'],
    // los otros rasters del mismo sensor (fotositos x 4.4 µm): hay grillas de planeamiento de
    // arrays hechas con 6K 16:9 (se ve midiendo sus puntos de fuga)
    ['komodo_6k_169', '6K 16:9', 5760, 3240, 25.34, 14.26, 4.4, 'derived'],
    ['komodo_5k_179', '5K 17:9', 5120, 2700, 22.53, 11.88, 4.4, 'derived'],
    ['komodo_4k_179', '4K 17:9', 4096, 2160, 18.02, 9.5, 4.4, 'derived'],
    ['komodo_4k_169', '4K 16:9 (UHD)', 3840, 2160, 16.9, 9.5, 4.4, 'derived'],
  ] },
  { id: 'canon_c70', make: 'Canon', model: 'C70 / C300 Mark III', names: ['EOS C70', 'C70', 'EOS C300 Mark III', 'C300 Mark III'], modes: [
    ['c70_4k_dci', '4K DCI S35', 4096, 2160, 26.20, 13.80, 6.4, 'derived'],
  ] },
  { id: 'bmd_pocket6k', make: 'Blackmagic', model: 'Pocket 6K', names: ['Blackmagic Pocket Cinema Camera 6K'], modes: [
    ['bmpcc6k_6k_169', '6K 16:9', 6144, 3456, 23.10, 12.99, 3.76, 'derived'],
  ] },
  { id: 'bmd_pocket4k', make: 'Blackmagic', model: 'Pocket 4K', names: ['Blackmagic Pocket Cinema Camera 4K'], modes: [
    ['bmpcc4k_4k_dci', '4K DCI', 4096, 2160, 18.96, 10.00, 4.63, 'derived'],
  ] },
  { id: 'apple_iphone12pro', make: 'Apple', model: 'iPhone 12 Pro', names: ['iPhone 12 Pro'], modes: [
    ['iph12_wide', 'Wide (4.2 mm)', 0, 0, 5.76, 4.29, 0, 'third-party'],
  ] },
];
// Si el nombre de la metadata no coincide exacto con ninguno: por patrón (orden: lo más específico primero).
const CAM_MODEL_RE = [
  [/alexa\s*35\s*xtreme/i, 'arri_alexa35_xtreme'], [/alexa\s*35/i, 'arri_alexa35'], [/alexa\s*265/i, 'arri_alexa265'],
  [/alexa\s*65/i, 'arri_alexa65'], [/mini\s*lf/i, 'arri_alexa_mini_lf'], [/alexa\s*lf/i, 'arri_alexa_lf'],
  [/alexa\s*mini/i, 'arri_alexa_mini'], [/amira/i, 'arri_amira'], [/alexa\s*sxt/i, 'arri_alexa_sxt'], [/alexa\s*xt/i, 'arri_alexa_xt_classic'],
  [/venice\s*2|mpc-?3628/i, 'sony_venice2_86k'], [/venice|mpc-?36(10|26)/i, 'sony_venice_6k'], [/burano|mpc-?2610/i, 'sony_burano'],
  [/fx9/i, 'sony_fx9'], [/fx30/i, 'sony_fx30'], [/fx6/i, 'sony_fx6'], [/fx3/i, 'sony_fx3'], [/f55/i, 'sony_f55'], [/f65/i, 'sony_f65'],
  [/v-?raptor/i, 'red_vraptor_vv'], [/komodo/i, 'red_komodo'], [/c70|c300/i, 'canon_c70'],
  [/pocket.*6k|bmpcc\s*6k/i, 'bmd_pocket6k'], [/pocket.*4k|bmpcc\s*4k/i, 'bmd_pocket4k'], [/iphone/i, 'apple_iphone12pro'],
];
// ids de los presets viejos de 3D Camera Pin (proyectos y settings guardados) -> clave cuerpo/modo
const CAM_LEGACY = {
  'alexa-lf-og': 'arri_alexa_mini_lf/mlf_45k_og', 'alexa-lf-169': 'arri_alexa_mini_lf/mlf_38k_169',
  'alexa35-og': 'arri_alexa35/a35_46k_og', 'alexa35-169': 'arri_alexa35/a35_4k_169',
  'alexamini-og': 'arri_alexa_mini/mini_og_34k', 'alexamini-169': 'arri_alexa_mini/mini_169_hd',
  'venice-ff': 'sony_venice_6k/v6k_6k_32', fx6: 'sony_fx6/fx6_ff_uhd', vraptor: 'red_vraptor_vv/vraptor_8k_vv_179',
  komodo: 'red_komodo/komodo_6k_179', c70: 'canon_c70/c70_4k_dci', bmpcc6k: 'bmd_pocket6k/bmpcc6k_6k_169',
  bmpcc4k: 'bmd_pocket4k/bmpcc4k_4k_dci', ff: 'generic/generic_ff36', s35: 'generic/generic_s35_4perf', iph12: 'apple_iphone12pro/iph12_wide',
};
const camModeObj = (b, m) => ({ body: b, id: m[0], key: b.id + '/' + m[0], label: m[1], pw: m[2], ph: m[3], w: m[4], h: m[5], pitch: m[6], conf: m[7] });
const camBodyName = (b) => b.make === 'Other' ? b.model : b.make + ' ' + b.model;
const camBody = (id) => CAM_CATALOG.find(b => b.id === id) || null;
function camModes(b) { return b ? b.modes.map(m => camModeObj(b, m)) : []; }
// 'cuerpo/modo' -> modo (o null para Custom); acepta los ids viejos
function camMode(key) {
  key = CAM_LEGACY[key] || key;
  const i = typeof key === 'string' ? key.indexOf('/') : -1; if (i < 0) return null;
  return camModes(camBody(key.slice(0, i))).find(m => m.id === key.slice(i + 1)) || null;
}
// cuerpo a partir del modelo de la metadata ("ARRI ALEXA 35"): exacto, sin la marca adelante, y por patrón
function camMatchBody(model) {
  const n = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const want = n(model); if (!want) return null;
  for (const b of CAM_CATALOG) if (b.names.some(x => n(x) === want)) return b;
  for (const b of CAM_CATALOG) { const p = n(b.make) + ' '; if (want.startsWith(p) && b.names.some(x => n(x) === want.slice(p.length))) return b; }
  const r = CAM_MODEL_RE.find(([re]) => re.test(want));
  return r ? camBody(r[1]) : null;
}
// modo cuyo raster grabado coincide exacto con el de la metadata (ej. 4608 x 3164)
const camMatchMode = (b, rw, rh) => rw > 0 && rh > 0 ? camModes(b).find(m => m.pw === rw && m.ph === rh) || null : null;
// sin raster: el modo con el aspecto del plate (es una suposición: se avisa). Entre los que coinciden al 1%,
// el primero del catálogo, que es el formato principal (8.1K FF antes que 5.4K S35 en una VENICE 2 a 16:9).
function camClosestMode(b, W, H) {
  const a = W / H, ms = camModes(b), d = (m) => Math.abs(m.w / m.h / a - 1);
  return ms.find(m => d(m) < 0.01) || ms.sort((x, y) => d(x) - d(y))[0] || null;
}
// Cómo llegó el plate: mismo aspecto que lo grabado = cuadro completo; si no, una extracción que ocupa todo el
// ancho (plate más panorámico) o todo el alto (más cuadrado). Es lo habitual (UHD desde Open Gate) y se corrige a mano.
function camGuessExtract(m, W, H) {
  if (!m || !(m.pw > 0 && m.ph > 0 && W > 0 && H > 0)) return null;
  const rec = m.pw / m.ph, pa = W / H;
  if (Math.abs(pa / rec - 1) < 0.005) return null; // un escalado redondea a px enteros: 4608x3164 -> 3840x2636
  return pa > rec ? { w: m.pw, h: Math.round(m.pw / pa) } : { w: Math.round(m.ph * pa), h: m.ph };
}
// área de sensor (mm) que cubre el plate; ex = extracción en fotositos del modo, null = cuadro completo
function camFilmBack(m, ex) {
  if (!ex || !(m.pw > 0 && m.ph > 0)) return { w: m.w, h: m.h };
  return { w: m.w * Math.min(ex.w, m.pw) / m.pw, h: m.h * Math.min(ex.h, m.ph) / m.ph };
}
// Bandas negras de un borde a otro (n filas o columnas; dark(k) = la k es negra): sólo si son parejas (±2 px),
// como las deja un escalado que encaja el cuadro grabado en otro formato (6K 17:9 en UHD: 67 px arriba y abajo).
function camBands(n, dark) {
  const run = (f) => { let k = 0; while (k < n / 4 && f(k)) k++; return k; };
  const a = run(dark), b = run((k) => dark(n - 1 - k));
  return Math.abs(a - b) <= 2 ? Math.min(a, b) : 0;
}
// Formato de un plate de W × H con el raster grabado del header (modo m) y bandas negras (bx, by px por lado): la
// imagen útil sin bandas con el aspecto de lo grabado es el cuadro entero; si no, una extracción. El header no dice
// cómo se encuadró, así que con bandas o extracción es una suposición (guess). sw: film del ancho TOTAL del plate.
function camPlateFormat(m, W, H, bx = 0, by = 0) {
  const uW = W - 2 * bx, uH = H - 2 * by, ex = camGuessExtract(m, uW, uH);
  return { ex, sw: camFilmBack(m, ex).w * W / uW, guess: !!ex || bx > 0 || by > 0 };
}
