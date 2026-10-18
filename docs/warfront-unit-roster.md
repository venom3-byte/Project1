# Warfront RTS — Combined-Arms Asset Roster

**Scene:** Blender 5.2 LTS, revision 8.
**Current inventory:** 27 ground vehicle classes, 1 aircraft root, 18 infantry archetypes represented by 24 scene prototypes.

The models are editable Blender prototypes with named roots and selected animation controls. They are not yet individually exported and connected as spawnable GLB unit assets in the live Three.js battle scene. Values in `roster.json` are abstract gameplay-balance numbers, not real-world performance specifications.

## Land systems

| Asset ID | Asset class | Blender root | Gameplay role |
|---|---|---|---|
| `mbt-main` | Main battle tank | `UNIT_MBT_MAIN_ROOT` | frontline_heavy |
| `light-tank` | Light tank | `UNIT_LT01_ROOT` | mobile_direct_fire |
| `ifv-tracked` | Tracked infantry fighting vehicle | `UNIT_IFV01_ROOT` | infantry_support |
| `apc-tracked` | Tracked armoured personnel carrier | `UNIT_APCT01_ROOT` | troop_transport |
| `howitzer-spg` | Self-propelled howitzer | `UNIT_SPG01_ROOT` | indirect_fire |
| `spaa` | Self-propelled anti-air gun | `UNIT_SPAA01_ROOT` | close_air_defence |
| `tracked-engineer` | Tracked armoured engineer vehicle | `UNIT_AEVT01_ROOT` | obstacle_clearance |
| `apc-8x8` | 8×8 armoured personnel carrier | `UNIT_APC8_ROOT` | troop_transport |
| `mrap` | Mine-resistant patrol vehicle | `UNIT_MRAP_ROOT` | protected_patrol |
| `recon` | Reconnaissance scout vehicle | `UNIT_SCOUT_ROOT` | scouting_and_spotting |
| `sam` | Mobile surface-to-air missile unit | `UNIT_SAM_ROOT` | longer_range_air_defence |
| `cargo` | Logistics cargo truck | `UNIT_CARGO_ROOT` | supply_delivery |
| `fuel` | Fuel and refuelling truck | `UNIT_FUEL_ROOT` | aircraft_and_vehicle_rearm |
| `recovery-truck` | Recovery and wrecker truck | `UNIT_WREC_ROOT` | vehicle_recovery |
| `command-radar` | Mobile command and radar vehicle | `UNIT_C2RAD_ROOT` | sensor_and_command |
| `bridge-layer` | Mobile bridge-layer support vehicle | `UNIT_BRIDGE_ROOT` | gap_crossing |
| `repair-truck` | Field repair and maintenance vehicle | `UNIT_REPAIR_ROOT` | repair_and_rearm |
| `electronic-support` | Electronic support and signals vehicle | `UNIT_EW_ROOT` | sensor_disruption_gameplay |
| `armoured-dozer` | Armoured dozer engineering vehicle | `UNIT_BULL_ROOT` | construction_and_obstacle_clearance |
| `mlrs` | Multiple launch rocket system 8×8 | `UNIT_MLRS01_ROOT` | area_fire_support |
| `wheeled-antitank` | Wheeled anti-armour missile carrier | `UNIT_ATGM_WHEEL01_ROOT` | anti_armour_support |
| `ambulance` | Field ambulance / casualty evacuation | `UNIT_AMB01_ROOT` | casualty_recovery |
| `light-utility` | Light tactical utility 4×4 | `UNIT_LUV01_ROOT` | liaison_and_light_transport |
| `amphibious-apc` | Amphibious 8×8 armoured personnel carrier | `UNIT_AMPH01_ROOT` | water_obstacle_transport |
| `towed-artillery` | Towed field artillery piece and limber | `UNIT_TOWART01_ROOT` | emplaced_indirect_fire |
| `tracked-recovery` | Tracked armoured recovery vehicle | `UNIT_ARV_T01_ROOT` | heavy_recovery_and_winch |
| `wheeled-ifv` | Wheeled infantry fighting / fire support vehicle | `UNIT_WIFV01_ROOT` | mobile_infantry_fire_support |

## Air asset

- **Strike fighter hero asset** — root `UNIT_STRIKE_JET_ROOT`; role: sortie_strike_and_recovery.

## Infantry and specialist roles

| Role | Archetype | Use in the game |
|---|---|---|
| `rifleman` | Rifle infantry | general_infantry |
| `leader` | Squad leader | command_and_squad_cohesion |
| `machine_gunner` | Machine gunner | area_suppression |
| `anti_armor` | Anti-armour specialist | armour_counter |
| `engineer` | Combat engineer | repair_and_obstacle_tasks |
| `medic` | Combat medic | casualty_support |
| `marksman` | Designated marksman | precision_support |
| `mortar` | Mortar crew | indirect_fire_support |
| `air_defence` | Man-portable air defence | local_air_defence |
| `radio` | Radio operator | communications |
| `officer` | Field officer | command_bonus |
| `recon` | Recon scout | reconnaissance_and_spotting |
| `grenadier` | Grenadier | explosive area-effect support |
| `sniper` | Sniper | precision long-range reconnaissance |
| `uav_operator` | UAV operator | deployable reconnaissance drone control |
| `tank_crew` | Armoured vehicle crewman | vehicle operation and repair bonus |
| `paratrooper` | Paratrooper / airborne infantry | airborne deployment and rapid insertion |
| `ammo_bearer` | Heavy-weapons ammunition bearer | team resupply and support-weapon endurance |

## Scene instances

| Blender root | Archetype | Squad |
|---|---|---|
| `INF_RIFLE_ROOT` | `rifleman` | A-1 |
| `INF_LEAD_ROOT` | `leader` | A-2 |
| `INF_MG_ROOT` | `machine_gunner` | A-3 |
| `INF_AT_ROOT` | `anti_armor` | A-4 |
| `INF_ENG_ROOT` | `engineer` | A-5 |
| `INF_MED_ROOT` | `medic` | A-6 |
| `INF_MRK_ROOT` | `marksman` | A-7 |
| `INF_MOR_ROOT` | `mortar` | A-8 |
| `INF_AAD_ROOT` | `air_defence` | A-9 |
| `INF_RAD_ROOT` | `radio` | B-1 |
| `INF_OFF_ROOT` | `officer` | B-2 |
| `INF_REC_ROOT` | `recon` | B-3 |
| `INF_RIFLE_B_ROOT` | `rifleman` | B-4 |
| `INF_LEAD_B_ROOT` | `leader` | B-5 |
| `INF_MG_B_ROOT` | `machine_gunner` | B-6 |
| `INF_AT_B_ROOT` | `anti_armor` | B-7 |
| `INF_MED_B_ROOT` | `medic` | B-8 |
| `INF_ENG_B_ROOT` | `engineer` | B-9 |
| `INF_GRN_ROOT` | `grenadier` | C-1 |
| `INF_SNP_ROOT` | `sniper` | C-2 |
| `INF_UAV_ROOT` | `uav_operator` | C-3 |
| `INF_TANKCREW_ROOT` | `tank_crew` | C-4 |
| `INF_PARA_ROOT` | `paratrooper` | C-5 |
| `INF_AMMO_ROOT` | `ammo_bearer` | C-6 |

## Integration state

1. The main battle tank has a named turret traversal pivot; the strike-aircraft hero has flaperon, elevator, rudder and landing-gear controls.
2. Tracked/wheeled prototypes have distinct silhouette parts and selected turret, gun, missile-rack or sensor pivots.
3. Infantry has 18 archetypes across 24 scene instances. Each rig keeps named hips, knees and shoulder controls; additional specialist roles have a basic keyed walk-cycle study.
4. The full Blender scene is committed as `public/warfront/assets/combined-arms-r8.glb`. The in-game catalog now has a “VIEW IN THEATRE” button: it loads the GLB, resolves the named root, and mounts a temporary preview on a staging pad. Individual per-unit GLB packages, live spawn/command binding for all classes, and a real browser gameplay regression run remain to be completed.

The roster manifest is the source of truth: `public/warfront/roster.json`.
