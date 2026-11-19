"""Static tables: every source the feed knows (live, key-gated, refused, paid), the platform board, the
categories and the series each one reads. Research basis: ResearchEcom 2026-11-14 (probes from this host)."""

# ---------------------------------------------------------------- FRED-hosted official series, grouped by publisher
# (key, label, group, series, unit, cadence, macro row?). One fredgraph request per source id.
FRED_SOURCES = {
    "census_ecom": {
        "name": "Quarterly e-commerce retail sales", "publisher": "US Census Bureau (via FRED)",
        "homepage": "https://www.census.gov/retail/ecommerce.html",
        "series": [
            ("ecom_share", "Online share of retail", "demand", "ECOMPCTSA", "pct", "quarterly", True),
            ("ecom_sales", "Online retail sales", "demand", "ECOMSA", "usd_m", "quarterly", True),
        ]},
    "census_retail": {
        "name": "Advance monthly retail trade", "publisher": "US Census Bureau (via FRED)",
        "homepage": "https://www.census.gov/retail/index.html",
        "series": [
            ("retail_sales", "Retail sales", "demand", "RSXFS", "usd_m", "monthly", True),
            ("nonstore_sales", "Nonstore retail sales", "demand", "RSNSR", "usd_m", "monthly", True),
            ("eshop_sales", "Online and mail-order sales", "demand", "MRTSSM4541USN", "usd_m", "monthly", True),
            ("sales_electronics", "Electronics store sales", "demand", "RSEAS", "usd_m", "monthly", False),
            ("sales_furniture", "Furniture store sales", "demand", "RSFHFS", "usd_m", "monthly", False),
            ("sales_clothing", "Clothing store sales", "demand", "RSCCAS", "usd_m", "monthly", False),
            ("sales_hobby", "Sporting goods, hobby and music store sales", "demand", "RSSGHBMS", "usd_m", "monthly", False),
            ("sales_health", "Health and personal care store sales", "demand", "RSHPCS", "usd_m", "monthly", False),
            ("sales_grocery", "Grocery store sales", "demand", "RSGCS", "usd_m", "monthly", False),
        ]},
    "bls_cpi": {
        "name": "Consumer price index", "publisher": "US Bureau of Labor Statistics (via FRED)",
        "homepage": "https://www.bls.gov/cpi/",
        "series": [
            ("cpi_core_goods", "Goods prices, core", "prices", "CUSR0000SACL1E", "index", "monthly", True),
            ("cpi_durables", "Durable goods prices", "prices", "CUSR0000SAD", "index", "monthly", True),
            ("cpi_computers", "Consumer prices, computers", "prices", "CUSR0000SEEE01", "index", "monthly", False),
            ("cpi_video_audio", "Consumer prices, video and audio", "prices", "CUSR0000SERA", "index", "monthly", False),
            ("cpi_home", "Consumer prices, household furnishings", "prices", "CUSR0000SAH3", "index", "monthly", False),
            ("cpi_apparel", "Consumer prices, apparel", "prices", "CPIAPPSL", "index", "monthly", False),
            ("cpi_personal_care", "Consumer prices, personal care", "prices", "CUSR0000SAG1", "index", "monthly", False),
            ("cpi_music", "Consumer prices, music instruments", "prices", "CUUR0000SERE03", "index", "monthly", False),
            ("cpi_food_home", "Consumer prices, food at home", "prices", "CUSR0000SAF11", "index", "monthly", False),
        ]},
    "bls_import": {
        "name": "Import price index", "publisher": "US Bureau of Labor Statistics (via FRED)",
        "homepage": "https://www.bls.gov/mxp/",
        "series": [("import_prices", "Import prices", "prices", "IR", "index", "monthly", True)]},
    "bls_ppi": {
        "name": "Producer price index, freight and parcel", "publisher": "US Bureau of Labor Statistics (via FRED)",
        "homepage": "https://www.bls.gov/ppi/",
        "series": [
            ("ppi_truckload", "Truckload freight rates", "freight", "PCU484121484121", "index", "monthly", True),
            ("ppi_parcel", "Parcel delivery prices", "parcel", "PCU492110492110", "index", "monthly", True),
        ]},
    "bea_pce": {
        "name": "Personal consumption expenditures, goods", "publisher": "US Bureau of Economic Analysis (via FRED)",
        "homepage": "https://www.bea.gov/data/consumer-spending/main",
        "series": [("pce_goods", "Spending on goods", "demand", "DGDSRC1", "usd_b", "monthly", True)]},
    "eia_diesel": {
        "name": "On-highway diesel price", "publisher": "US Energy Information Administration (via FRED)",
        "homepage": "https://www.eia.gov/petroleum/gasdiesel/",
        "series": [("diesel", "Diesel price", "freight", "GASDESW", "usd_gal", "weekly", True)]},
    "cass_freight": {
        "name": "Cass Freight Index", "publisher": "Cass Information Systems (via FRED)",
        "homepage": "https://www.cassinfo.com/freight-audit-payment/cass-transportation-indexes/cass-freight-index",
        "series": [
            ("cass_shipments", "Freight shipments", "freight", "FRGSHPUSM649NCIS", "index", "monthly", True),
            ("cass_spend", "Freight spending", "freight", "FRGEXPUSM649NCIS", "index", "monthly", True),
        ]},
    "umich_sentiment": {
        "name": "Surveys of Consumers", "publisher": "University of Michigan (via FRED)",
        "homepage": "https://www.sca.isr.umich.edu/",
        "series": [("sentiment", "Consumer sentiment", "demand", "UMCSENT", "index", "monthly", True)]},
    "bts_freight": {
        "name": "Freight transportation services index", "publisher": "US Bureau of Transportation Statistics (via FRED)",
        "homepage": "https://www.bts.gov/tsi",
        "series": [("freight_tsi", "Freight activity", "freight", "TSIFRGHT", "index", "monthly", True)]},
}

# ---------------------------------------------------------------- every other source (live and key-gated)
LIVE_SOURCES = {
    "apple_chart": ("App Store top free shopping apps (US)", "Apple", "rank", "platforms",
                    "https://itunes.apple.com/us/rss/topfreeapplications/limit=100/genre=6024/json"),
    "tranco": ("Tranco top sites list", "Tranco (KU Leuven, Stony Brook, TU Delft)", "rank", "platforms", "https://tranco-list.eu/"),
    "google_trends": ("Trending searches, US", "Google Trends", "rank", "interest", "https://trends.google.com/trending?geo=US"),
    "wikimedia": ("Wikipedia page views", "Wikimedia Foundation", "api", "interest", "https://wikimedia.org/api/rest_v1/"),
    "shopify_stores": ("Shopify store catalogs", "Allbirds, Kith, Tentree, Brooklinen, Taylor Stitch, ColourPop", "catalog", "prices",
                       "https://shopify.dev/docs/storefronts/themes/architecture/templates/product"),
    "steam_store": ("Steam store top sellers and specials", "Valve", "catalog", "prices", "https://store.steampowered.com/search/?filter=topsellers"),
    "reverb_api": ("Reverb listings API", "Reverb", "api", "prices", "https://reverb.com/page/api"),
    "scryfall": ("Scryfall card prices", "Scryfall (TCGplayer market prices)", "api", "prices", "https://scryfall.com/docs/api"),
    "drewry_wci": ("World Container Index", "Drewry", "page", "macro",
                   "https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/world-container-index-assessed-by-drewry"),
    "fedex_fuel": ("FedEx fuel surcharges", "FedEx", "page", "macro", "https://www.fedex.com/en-us/shipping/fuel-surcharge.html"),
    "usps_prices": ("USPS Notice 123 price list", "US Postal Service", "page", "macro", "https://pe.usps.com/text/dmm300/Notice123.htm"),
    "port_la": ("Port of Los Angeles container statistics", "Port of Los Angeles", "page", "macro",
                "https://www.portoflosangeles.org/business/statistics/container-statistics"),
    "federal_register": ("Federal Register trade notices", "Office of the Federal Register", "api", "macro",
                         "https://www.federalregister.gov/developers/documentation/api/v1"),
    "shop_collector": ("Shop collector watch prices", "Owner's shop collector (asking prices)", "collector", "prices",
                       "file://~/.kodros/status/house-feeds/ecom.json"),
}

KEYED_SOURCES = {
    "ebay_browse": ("eBay Browse API", "eBay", "api", "prices", ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"],
                    "https://developer.ebay.com/api-docs/buy/browse/overview.html"),
    "bestbuy_api": ("Best Buy Products API", "Best Buy", "api", "prices", ["BESTBUY_API_KEY"], "https://developer.bestbuy.com/"),
    "etsy_api": ("Etsy Open API v3", "Etsy", "api", "prices", ["ETSY_API_KEY"], "https://developers.etsy.com/documentation/"),
    "census_api": ("Census economic indicators API", "US Census Bureau", "official", "macro", ["CENSUS_API_KEY"],
                   "https://www.census.gov/data/developers/data-sets/economic-indicators.html"),
    "bls_api": ("BLS public data API v2, average prices", "US Bureau of Labor Statistics", "official", "macro", ["BLS_API_KEY"],
                "https://www.bls.gov/developers/"),
    "cloudflare_radar": ("Cloudflare Radar domain ranking", "Cloudflare", "rank", "platforms", ["CLOUDFLARE_API_TOKEN"],
                         "https://developers.cloudflare.com/radar/"),
}

# Never called. Reason is what the Data sheet shows. Paid ones carry a price instead of a call.
REFUSED_SOURCES = {
    "amazon_web": ("Amazon store and best-seller pages", "Amazon", "Amazon terms bar automated reads",
                   "https://www.amazon.com/gp/help/customer/display.html?nodeId=508088"),
    "walmart_web": ("Walmart best-seller pages", "Walmart", "Bot wall (Robot or human page)", "https://www.walmart.com/"),
    "ebay_web": ("eBay site pages", "eBay", "Site refuses this host (HTTP 403); the API is the allowed route", "https://www.ebay.com/"),
    "etsy_web": ("Etsy site pages", "Etsy", "Bot wall (HTTP 403); the API is the allowed route", "https://www.etsy.com/"),
    "target_web": ("Target", "Target", "No public API; private site APIs are not used", "https://www.target.com/"),
    "homedepot_web": ("The Home Depot", "The Home Depot", "Bot wall (Access Denied)", "https://www.homedepot.com/"),
    "lowes_web": ("Lowe's", "Lowe's", "Bot wall (Access Denied)", "https://www.lowes.com/"),
    "wayfair_web": ("Wayfair", "Wayfair", "Bot wall (Press and Hold)", "https://www.wayfair.com/"),
    "chewy_web": ("Chewy", "Chewy", "Bot wall (HTTP 429 challenge)", "https://www.chewy.com/"),
    "mercari_web": ("Mercari", "Mercari", "Bot wall (Cloudflare challenge)", "https://www.mercari.com/"),
    "temu_web": ("Temu", "Temu", "No public product API", "https://www.temu.com/"),
    "shein_web": ("SHEIN", "SHEIN", "No public product API", "https://us.shein.com/"),
    "tiktok_shop": ("TikTok Shop top products", "TikTok", "No public product API; host blocked on this network",
                    "https://seller-us.tiktok.com/"),
    "google_shopping_web": ("Google Shopping", "Google", "Google terms bar automated queries", "https://shopping.google.com/"),
    "google_play_charts": ("Google Play charts", "Google", "No chart API; Play terms bar scraping", "https://play.google.com/store/apps"),
    "ups_fuel": ("UPS fuel surcharge page", "UPS", "Bot wall (Access Denied)", "https://www.ups.com/us/en/support/shipping-support/shipping-costs-rates/fuel-surcharges.page"),
    "port_long_beach": ("Port of Long Beach statistics", "Port of Long Beach", "Bot wall (HTTP 403)", "https://polb.com/business/port-statistics/"),
    "camelcamelcamel": ("CamelCamelCamel price drops", "CamelCamelCamel", "Bot wall (Cloudflare challenge)", "https://camelcamelcamel.com/"),
    "cheapshark": ("CheapShark game deals API", "CheapShark", "robots.txt disallows /api/1.0/", "https://apidocs.cheapshark.com/"),
    "amazon_suggest": ("Amazon search suggestions", "Amazon", "Undocumented endpoint; Amazon terms bar robots",
                       "https://www.amazon.com/gp/help/customer/display.html?nodeId=508088"),
}
PAID_SOURCES = {
    "keepa": ("Keepa API (Amazon price and rank history)", "Keepa", "EUR 49 a month", "https://keepa.com/#!api"),
    "rainforest": ("Rainforest API (Amazon best sellers)", "Traject Data", "$23 to $83 a month", "https://www.trajectdata.com/ecommerce/rainforest-api/"),
    "dataforseo": ("DataForSEO Merchant API (Google Shopping)", "DataForSEO", "$50 minimum top-up", "https://dataforseo.com/apis/merchant-api"),
    "similarweb": ("Similarweb traffic API", "Similarweb", "About $15,000 a year", "https://www.similarweb.com/corp/developer/"),
}

# ---------------------------------------------------------------- platform board
# (name, domain for Tranco or None, kind, App Store id or None, shop collector site or None, own price source or None)
PLATFORMS = [
    ("Amazon", "amazon.com", "marketplace", "297606951", "amazon", None),
    ("Walmart", "walmart.com", "retailer", "338137227", "walmart", None),
    ("eBay", "ebay.com", "marketplace", "282614216", None, "ebay_browse"),
    ("Temu", "temu.com", "marketplace", "1641486558", None, None),
    ("Target", "target.com", "retailer", "297430070", None, None),
    ("Costco", "costco.com", "retailer", "535509415", "costco", None),
    ("Best Buy", "bestbuy.com", "retailer", "314855255", "bestbuy", "bestbuy_api"),
    ("AliExpress", "aliexpress.com", "marketplace", "436672029", None, None),
    ("SHEIN", "shein.com", "retailer", "878577184", None, None),
    ("Etsy", "etsy.com", "marketplace", "477128284", None, "etsy_api"),
    ("The Home Depot", "homedepot.com", "retailer", "342527639", None, None),
    ("Lowe's", "lowes.com", "retailer", "457954781", None, None),
    ("Wayfair", "wayfair.com", "retailer", "836767708", None, None),
    ("Macy's", "macys.com", "retailer", "341036067", "macys", None),
    ("Sam's Club", "samsclub.com", "retailer", "382497397", None, None),
    ("Kohl's", "kohls.com", "retailer", "472014516", None, None),
    ("Vinted", "vinted.com", "resale", "632064380", None, None),
    ("Depop", "depop.com", "resale", "518684914", None, None),
    ("Whatnot", "whatnot.com", "marketplace", "1488269261", None, None),
    ("Shop (Shopify)", "shop.app", "marketplace", "1223471316", None, "shopify_stores"),
    ("Facebook Marketplace", None, "marketplace", None, "facebook-marketplace", None),
    ("Craigslist", "craigslist.org", "marketplace", None, "craigslist", None),
    ("OfferUp", "offerup.com", "resale", "468996152", "offerup", None),
    ("Poshmark", "poshmark.com", "resale", "470412147", "poshmark", None),
    ("Mercari", "mercari.com", "resale", "896130944", None, None),
    ("Newegg", "newegg.com", "retailer", None, "newegg", None),
    ("GameStop", "gamestop.com", "retailer", None, "gamestop", None),
    ("Micro Center", "microcenter.com", "retailer", None, "microcenter", None),
    ("Back Market", "backmarket.com", "resale", None, "backmarket", None),
    ("Chewy", "chewy.com", "retailer", "1149449468", None, None),
    ("DICK'S Sporting Goods", "dickssportinggoods.com", "retailer", "556653197", None, None),
    ("StockX", "stockx.com", "resale", "881599819", None, None),
    ("Alibaba", "alibaba.com", "marketplace", "503451073", None, None),
    ("Nike", "nike.com", "brand", "1095459556", None, None),
    ("Sephora", "sephora.com", "retailer", "393328150", None, None),
    ("Ulta Beauty", "ulta.com", "retailer", "561930308", None, None),
    ("IKEA", "ikea.com", "retailer", "1452164827", None, None),
    ("Kroger", "kroger.com", "grocery", "403901186", None, None),
    ("Dollar General", "dollargeneral.com", "retailer", "561311442", None, None),
    ("Steam", "steampowered.com", "marketplace", None, None, "steam_store"),
    ("Reverb", "reverb.com", "marketplace", None, None, "reverb_api"),
    ("TCGplayer", "tcgplayer.com", "marketplace", None, None, "scryfall"),
]
PLATFORM_NOTES = {"Facebook Marketplace": "No rank signal of its own: facebook.com traffic is not Marketplace traffic.",
                  "Alibaba": "Business-to-business wholesale."}

# ---------------------------------------------------------------- categories
# key: (label, CPI macro key or None, Census sales key or None)
CATEGORIES = {
    "computers": ("Computers and parts", "cpi_computers", "sales_electronics"),
    "electronics": ("TV, audio and phones", "cpi_video_audio", "sales_electronics"),
    "home": ("Home", "cpi_home", "sales_furniture"),
    "apparel": ("Clothing and shoes", "cpi_apparel", "sales_clothing"),
    "beauty": ("Beauty and personal care", "cpi_personal_care", "sales_health"),
    "games": ("PC games", None, None),
    "music": ("Music gear", "cpi_music", "sales_hobby"),
    "collectibles": ("Trading cards", None, "sales_hobby"),
    "outdoors": ("Outdoors and sports", None, "sales_hobby"),
    "grocery": ("Grocery", "cpi_food_home", "sales_grocery"),
}
# shop collector watch category -> feed category
WATCH_CATEGORY = {"computer": "computers", "laptops": "computers", "tv": "electronics", "audio": "electronics",
                  "phones": "electronics", "gaming": "electronics", "kitchen": "home", "home": "home", "apparel": "apparel",
                  "bikes": "outdoors", "outdoors": "outdoors", "grocery": "grocery"}
# Wikipedia articles for watches that do not name one themselves
WATCH_WIKI = {"rtx-5090": "GeForce_50_series", "rtx-5080": "GeForce_50_series", "rtx-4080": "GeForce_40_series",
              "rtx-4070": "GeForce_40_series", "pellet-grill": "Pellet_grill", "smart-home-hub": "Home_automation",
              "fire-blanket": "Fire_blanket", "canned-water": "Canned_water", "palestinian-olive-oil": "Olive_oil",
              "multi-use-lubricant-spray": "WD-40", "fishing-crankbait-lure": "Fishing_lure",
              "portable-water-purifier-bottle": "Portable_water_purification", "dgx-spark": "Nvidia_DGX"}

SHOPIFY_STORES = [  # (host, brand, category); best-seller collection handles are tried in order
    ("www.allbirds.com", "Allbirds", "apparel"),
    ("kith.com", "Kith", "apparel"),
    ("www.tentree.com", "Tentree", "apparel"),
    ("www.taylorstitch.com", "Taylor Stitch", "apparel"),
    ("www.brooklinen.com", "Brooklinen", "home"),
    ("colourpop.com", "ColourPop", "beauty"),
]
SHOPIFY_BEST_HANDLES = ("best-sellers", "bestsellers")

REVERB_MODELS = [  # (make, model, query)
    ("Fender", "Player Stratocaster", "fender player stratocaster"),
    ("Fender", "Player Telecaster", "fender player telecaster"),
    ("Gibson", "Les Paul Standard", "gibson les paul standard"),
    ("Boss", "Katana 50", "boss katana 50"),
    ("Shure", "SM58", "shure sm58"),
    ("Focusrite", "Scarlett 2i2", "focusrite scarlett 2i2"),
    ("Yamaha", "P-45", "yamaha p-45"),
    ("Roland", "TD-07", "roland td-07"),
]
