#!/usr/bin/env bun
// Fetch Ramsey County parcel data from the county's public ArcGIS REST service
// and cache it as newline-delimited JSON (one parcel's raw attributes per line)
// in data/ramsey_parcels.ndjson.
//
// Ramsey retired its downloadable GeoPackage when the MN Geospatial Commons moved
// to an ArcGIS Hub (gis.data.mn.gov), so we page the county's attributed parcel
// point layer (2,000 records at a time, ~170k parcels) instead. Field names match
// the old plan_attributedparcelpoint table, so build-db maps them one-to-one.
//
// Run with: bun run scripts/fetch-ramsey.mjs

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchLayerToNdjson } from "./arcgis.mjs";

const LAYER =
  "https://gis.ramseycountymn.gov/server/rest/services/Cadastral/CAD_AttributedParcelPoint_ViewOnly/FeatureServer/0";

// Only the attributes build-db keeps — the same names as its COLUMNS list.
const OUT_FIELDS = [
  "ParcelID",
  "OwnershipCategory",
  "OwnerName",
  "OwnerName1",
  "OwnerName2",
  "OwnerLastName",
  "OwnerAddress1",
  "OwnerAddress2",
  "OwnerCityStateZIP",
  "TaxName1",
  "TaxName2",
  "TaxAddress1",
  "TaxAddress2",
  "TaxCityStateZIP",
  "SiteAddress",
  "SiteCityName",
  "SiteZIP5",
  "LandUseCodeDescription",
  "StructureDescription",
  "DwellingType",
  "YearBuilt",
  "BedRoom",
  "LivingAreaSquareFeet",
  "ParcelAcresDeed",
  "ParcelSquareFeet",
  "TaxYear",
  "EMVLand",
  "EMVBuilding",
  "EMVTotal",
  "TotalTax",
  "LastSaleDate",
  "SalePrice",
  "Latitude",
  "Longitude",
];

const __dirname = dirname(fileURLToPath(import.meta.url));

await fetchLayerToNdjson({
  label: "Ramsey",
  layer: LAYER,
  outFields: OUT_FIELDS,
  outPath: join(__dirname, "..", "data", "ramsey_parcels.ndjson"),
});
