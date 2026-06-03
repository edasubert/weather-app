export type ModelGroup = 'auto' | 'seamless' | 'global' | 'regional';

export interface WeatherModel {
  id: string;
  name: string;
  shortLabel: string;
  provider: string;
  coverage: string;
  group: ModelGroup;
}

export const DEFAULT_MODEL = 'ecmwf_ifs025';

export const WEATHER_MODELS: WeatherModel[] = [
  { id: 'best_match',                      name: 'Best Match',                  shortLabel: 'Auto',     provider: 'Open-Meteo',         coverage: 'Automatic — picks best model for your location', group: 'auto'     },
  { id: 'icon_seamless',                   name: 'ICON Seamless',               shortLabel: 'ICON',     provider: 'DWD (Germany)',       coverage: 'Global + Europe + Central Europe',               group: 'seamless' },
  { id: 'gfs_seamless',                    name: 'GFS Seamless',                shortLabel: 'GFS',      provider: 'NOAA (USA)',          coverage: 'Global + Contiguous US',                         group: 'seamless' },
  { id: 'gem_seamless',                    name: 'GEM Seamless',                shortLabel: 'GEM',      provider: 'ECCC (Canada)',       coverage: 'Global + North America',                         group: 'seamless' },
  { id: 'meteofrance_seamless',            name: 'Météo-France Seamless',       shortLabel: 'MF',       provider: 'Météo-France',        coverage: 'Global + Europe + France',                       group: 'seamless' },
  { id: 'jma_seamless',                    name: 'JMA Seamless',                shortLabel: 'JMA',      provider: 'JMA (Japan)',         coverage: 'Global + Japan',                                 group: 'seamless' },
  { id: 'metno_seamless',                  name: 'MetNo Seamless',              shortLabel: 'MetNo',    provider: 'MET Norway',          coverage: 'Global + Nordic countries',                      group: 'seamless' },
  { id: 'knmi_seamless',                   name: 'KNMI Seamless',               shortLabel: 'KNMI',     provider: 'KNMI (Netherlands)',  coverage: 'Global + NW Europe',                             group: 'seamless' },
  { id: 'dmi_seamless',                    name: 'DMI Seamless',                shortLabel: 'DMI',      provider: 'DMI (Denmark)',       coverage: 'Global + Scandinavia/Europe',                    group: 'seamless' },
  { id: 'ukmo_seamless',                   name: 'UK Met Office Seamless',      shortLabel: 'UKMO',     provider: 'UK Met Office',       coverage: 'Global + UK',                                    group: 'seamless' },
  { id: 'arpae_cosmo_seamless',            name: 'COSMO Seamless',              shortLabel: 'COSMO',    provider: 'ARPAE (Italy)',       coverage: 'Global + Italy & surroundings',                  group: 'seamless' },
  { id: 'ecmwf_ifs025',                    name: 'ECMWF IFS 0.25°',            shortLabel: 'ECMWF',    provider: 'ECMWF',               coverage: 'Global, 0.25° resolution',                       group: 'global'   },
  { id: 'ecmwf_ifs04',                     name: 'ECMWF IFS 0.4°',             shortLabel: 'ECMWF',    provider: 'ECMWF',               coverage: 'Global, 0.4° resolution',                        group: 'global'   },
  { id: 'ecmwf_aifs025',                   name: 'ECMWF AIFS 0.25°',           shortLabel: 'AIFS',     provider: 'ECMWF (AI)',          coverage: 'Global, AI-based model',                         group: 'global'   },
  { id: 'gfs_global',                      name: 'GFS 0.25°',                   shortLabel: 'GFS',      provider: 'NOAA (USA)',          coverage: 'Global',                                         group: 'global'   },
  { id: 'icon_global',                     name: 'ICON 11km',                   shortLabel: 'ICON',     provider: 'DWD (Germany)',       coverage: 'Global',                                         group: 'global'   },
  { id: 'gem_global',                      name: 'GEM 15km',                    shortLabel: 'GEM',      provider: 'ECCC (Canada)',       coverage: 'Global',                                         group: 'global'   },
  { id: 'meteofrance_arpege_world',        name: 'ARPEGE World 0.25°',          shortLabel: 'ARPEGE',   provider: 'Météo-France',        coverage: 'Global',                                         group: 'global'   },
  { id: 'jma_gsm',                         name: 'JMA GSM 0.5°',                shortLabel: 'JMA',      provider: 'JMA (Japan)',         coverage: 'Global',                                         group: 'global'   },
  { id: 'ukmo_global_deterministic_10km',  name: 'UK Met Office 10km',          shortLabel: 'UKMO',     provider: 'UK Met Office',       coverage: 'Global',                                         group: 'global'   },
  { id: 'cma_grapes_global',               name: 'GRAPES',                      shortLabel: 'GRAPES',   provider: 'CMA (China)',         coverage: 'Global',                                         group: 'global'   },
  { id: 'bom_access_global',               name: 'ACCESS-G',                    shortLabel: 'ACCESS',   provider: 'BOM (Australia)',     coverage: 'Global',                                         group: 'global'   },
  { id: 'gfs_graphcast025',                name: 'GraphCast 0.25°',             shortLabel: 'GCast',    provider: 'Google (AI)',         coverage: 'Global, AI-based',                               group: 'global'   },
  { id: 'gfs_hrrr',                        name: 'HRRR 3km',                    shortLabel: 'HRRR',     provider: 'NOAA (USA)',          coverage: 'Contiguous US only',                             group: 'regional' },
  { id: 'icon_eu',                         name: 'ICON-EU 7km',                 shortLabel: 'ICON EU',  provider: 'DWD (Germany)',       coverage: 'Europe only',                                    group: 'regional' },
  { id: 'icon_d2',                         name: 'ICON-D2 2km',                 shortLabel: 'ICON D2',  provider: 'DWD (Germany)',       coverage: 'Germany & neighbouring countries',                group: 'regional' },
  { id: 'meteofrance_arpege_europe',       name: 'ARPEGE Europe 0.1°',          shortLabel: 'ARPEGE',   provider: 'Météo-France',        coverage: 'Europe only',                                    group: 'regional' },
  { id: 'meteofrance_arome_france',        name: 'AROME France 0.025°',         shortLabel: 'AROME',    provider: 'Météo-France',        coverage: 'France & surroundings',                          group: 'regional' },
  { id: 'meteofrance_arome_france_hd',     name: 'AROME HD',                    shortLabel: 'AROME HD', provider: 'Météo-France',        coverage: 'France & surroundings (high-res)',               group: 'regional' },
  { id: 'jma_msm',                         name: 'JMA MSM 5km',                 shortLabel: 'JMA MSM',  provider: 'JMA (Japan)',         coverage: 'Japan only',                                     group: 'regional' },
  { id: 'gem_regional',                    name: 'GEM Regional 10km',           shortLabel: 'GEM Reg',  provider: 'ECCC (Canada)',       coverage: 'North America only',                             group: 'regional' },
  { id: 'gem_hrdps_continental',           name: 'HRDPS 2.5km',                 shortLabel: 'HRDPS',    provider: 'ECCC (Canada)',       coverage: 'Canada only',                                    group: 'regional' },
  { id: 'metno_nordic',                    name: 'MetNo Nordic 1km',            shortLabel: 'MetNo',    provider: 'MET Norway',          coverage: 'Norway, Sweden, Finland, Denmark',               group: 'regional' },
  { id: 'ukmo_uk_deterministic_2km',       name: 'UK Met Office 2km',           shortLabel: 'UKMO',     provider: 'UK Met Office',       coverage: 'UK only',                                        group: 'regional' },
  { id: 'knmi_harmonie_arome_europe',      name: 'Harmonie-AROME 5.5km (KNMI)', shortLabel: 'KNMI',    provider: 'KNMI (Netherlands)',  coverage: 'NW Europe only',                                 group: 'regional' },
  { id: 'dmi_harmonie_arome_europe',       name: 'Harmonie-AROME 5.5km (DMI)',  shortLabel: 'DMI',     provider: 'DMI (Denmark)',       coverage: 'NW/Central Europe only',                         group: 'regional' },
  { id: 'arpae_cosmo_2i',                  name: 'COSMO 2I 2.2km',              shortLabel: 'COSMO',    provider: 'ARPAE (Italy)',       coverage: 'Italy only',                                     group: 'regional' },
  { id: 'arpae_cosmo_5m',                  name: 'COSMO 5M 5km',                shortLabel: 'COSMO',    provider: 'ARPAE (Italy)',       coverage: 'N Italy & S Austria',                            group: 'regional' },
];

export const MODEL_MAP = new Map<string, WeatherModel>(WEATHER_MODELS.map(m => [m.id, m]));

export function findModel(id: string): WeatherModel {
  return MODEL_MAP.get(id) ?? { id, name: id, shortLabel: id, provider: 'Unknown', coverage: 'Unknown', group: 'global' };
}
