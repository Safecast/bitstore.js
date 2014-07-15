// bitstore.js --   Author: Nick Dolezal, 2013-2014
//                Abstract: General bitmap indexing solution for improving raster tile map performance.
//               Copyright: This code is released into the public domain.
//


// It is expected that you will minify this with something like jscompress.com, so comments have not been stripped.



// Requirements
// ============
// Data
//  - 1. 256x256 Web Mercator PNG tiles with alpha channel that correlates with tiles intentionally not present
//  - 2. Google Maps tile X/Y/Z convention.
//  - 3. A single tile that shows the entire dataset at once.  (guaranteed to be the zoom level 0 tile)
// Script Dependencies:
//  - 1. png.js / zlib.js -- entirely optional, but recommended.  Significantly improves performance over HTML5 Canvas.
//      Source: http://github.com/devongovett/png.js/



// Components
// ==========
// Single file solution.  100% pure vanilla standards-compliant JavaScript.
//
// 1. bitstore.js:
//    - Class: LBITS - Layer Bitstore (holds 1...n BITS)
//    - Class: BITS  - Bitstore
//    - Class: LBITSOptions - for specfying extra stuff manually to LBITS
//


// Example
// ==================
//
//  1. Instantiate with constructor at startup:
// --------------------------------------------
//
// // Basic Configuration:
//
//     MY_FIRST_BARBIE_GLOBAL_POINTER = new LBITS(2, 0, 16, "http://safecast.org/tilemap/tiles/{z}/tile_{z}_{x}_{y}.png", 0, 0, null, null);
//
//
// // Custom Configuration, with options and date callback:
//
//     var opts = new LBITSOptions({ idx_max_bitmap_z:5 });
//
//     var dateCallback = function(dateString)
//     {
//        document.getElementById("0").innerText += " " + dateString;
//     };
//
//     MY_FIRST_BARBIE_GLOBAL_POINTER = new LBITS(2, 0, 16, "http://safecast.org/tilemap/tiles/{z}/tile_{z}_{x}_{y}.png",  0, 0, opts, dateCallback);
//
//
//
//  2. Add "ShouldLoadTile" to Google Maps API tile callback.
// ----------------------------------------------------------
//
//
//     getTileUrl: function (xy, z) 
//                 {
//                    var nXY = getNormalizedCoord(xy, z);       // code here: http://developers.google.com/maps/documentation/javascript/maptypes
//        
//                    if (    !nXY
//                        || (!MY_FIRST_BARBIE_GLOBAL_POINTER.ShouldLoadTile(2, nXY.x, nXY.y, z)))
//                    {
//                        return null;
//                    }//if
//
//                    return "http://safecast.org/tilemap/tiles/"+z+"/tile_"+z+"_"+nXY.x+"_"+nXY.y+".png"
//                  }





// LBITS -- Layer Bitstore
// =======================

// The Layer Bitstore (LBITS) "class" is a convienience wrapper that automates indexing a layer.
//
// Once set up with a couple numbers and a URL, it is fully automated, self-updating, and client-side.
// 
// It only needs to know a few things:
// 1. The min and max zoom levels of your layer
// 2. A URL template to use, substituting {z} {x} and {y} for numbers.
// 3. The x/y/z for a single RGBA8888 PNG tile that indexes the entire dataset.  This is guaranteed to be the z=0 tile for every dataset.
// 4. A unique layerId to differentiate it from other tilesets.  Or, you can reuse a layerId if you want a proxy and less memory use, 
//    for datasets that are mostly the same.
//
// When passed this information in the layer constructor, it will:
// 1. Load the PNG (or from cache, if present)
// 2. Create an initial "master" global bitmap index from the alpha channel
// 3. Calculate the layer's extent
// 4. Determine what other indices are needed.
//    a. Find a single tile to do this, if possible.
//    b. If not, decompose and reproject the global index into a list of many additional tiles.
// 5. Create bitstores for 0 - n additional tiles found in #3
// 
//
// 

// 2014-07-15 ND: bugfix for remainder chunk handling in hex string serialization/deserialization
// 2014-06-27 ND: most processing now can happen in web workers.
//                inlined bit tests, better loop unrolls for non-p2s, fix for max idx z not being enforced.
//                move try/catch blocks to own functions so they don't block V8 optimizations.
//                now purges old caches for a layer.
// 2014-06-23 ND: changed alt lazy load mode to force load on first access, regardless of zoom level.  also will queue if master not done.
// 2014-06-22 ND: bugfix: typo in min tile x/y input sanity check
// 2014-06-22 ND: bugfix: copypasta typos in layer extent iterative refinement step
// 2014-06-22 ND: bugfix: cached index would save itself to the store again (wasting I/O)
// 2014-06-22 ND: added multithreading
// 2014-06-21 ND: refactoring
// 2014-06-19 ND: added date to URL for tile request due to browser caching issues where the HTTP last-modified was correctly reported (odd)
// 2014-06-18 ND: during index autoselection, if the number of tiles exceeds the constraint, it is retried at a lower zoom level instead of
//                being truncated, which provided poor indexing.

var LBITSOptions = (function()
{
    function LBITSOptions()
    {
        this.net_multithreading     = false;
        this.net_worker_inc0_url    = null;
        this.net_worker_inc1_url    = null;
        this.net_worker_inc2_url    = null;
        
        this.net_cache_enable       = true;
        this.net_src_png_format     = true;
        this.net_src_hex_format     = false;
        this.net_url_append_enable  = true;

        this.idx_max_bitmap_n       = 256;
        this.idx_max_bitmap_z       = 8;
        this.idx_datecheck_enable   = true;
        this.idx_lazyload_detail    = true;
        this.idx_lazyload_dim       = true;
        
        this.img_io_canvas_enable   = false;
        
        this.img_fx_unshadow        = false;
        this.img_fx_unstroke        = false;
        this.img_ch_offset          = 3;
        this.img_alpha_threshold    = 1;
        
        // lazy shorthand aliases for the above
        
        this.multi = false;
        this.url0  = null;
        this.url1  = null;
        this.url2  = null;
        this.cache = true;
        this.png   = true;
        this.hex   = true;
        this.appnd = true;
        this.maxn  = 256;
        this.maxz  = 8;
        this.date  = true;
        this.ll    = true;
        this.lldim = true;
        this.ctx   = false;
        this.unshd = false;
        this.unstr = false;
        this.choff = 3;
        this.alpha = 1;
        
        for (var n in arguments[0]) { this[n] = arguments[0][n]; }
        
        this.multi = this.i2b(this.multi);
        this.cache = this.i2b(this.cache);
        this.png   = this.i2b(this.png);
        this.hex   = this.i2b(this.hex);
        this.apnd  = this.i2b(this.appnd);
        this.date  = this.i2b(this.date);
        this.ll    = this.i2b(this.ll);
        this.lldim = this.i2b(this.lldim);
        this.ctx   = this.i2b(this.ctx);
        this.unshd = this.i2b(this.unshd);
        this.unstr = this.i2b(this.unstr);
        
        this.net_multithreading    = this.i2b(this.net_multithreading);
        this.net_cache_enable      = this.i2b(this.net_cache_enable);
        this.net_src_png_format    = this.i2b(this.net_src_png_format);
        this.net_src_hex_format    = this.i2b(this.net_src_hex_format);
        this.net_url_append_enable = this.i2b(this.net_url_append_enable);
        this.idx_datecheck_enable  = this.i2b(this.idx_datecheck_enable);
        this.idx_lazyload_detail   = this.i2b(this.idx_lazyload_detail);
        this.idx_lazyload_dim      = this.i2b(this.idx_lazyload_dim);
        this.img_io_canvas_enable  = this.i2b(this.img_io_canvas_enable);
        this.img_fx_unshadow       = this.i2b(this.img_fx_unshadow);
        this.img_fx_unstroke       = this.i2b(this.img_fx_unstroke);
        
        this.net_multithreading    |= this.multi;
        this.net_worker_inc0_url    = this.url0 != null ? this.url0 : this.net_worker_inc0_url;
        this.net_worker_inc1_url    = this.url1 != null ? this.url1 : this.net_worker_inc1_url;
        this.net_worker_inc2_url    = this.url2 != null ? this.url2 : this.net_worker_inc2_url;
        this.net_cache_enable       = this.net_cache_enable      && this.cache;
        this.net_src_png_format     = this.net_src_png_format    && this.png;
        this.net_src_hex_format    |= this.hex;
        this.net_url_append_enable  = this.net_url_append_enable && this.appnd;
        this.idx_max_bitmap_n       = this.maxn != 256 ? this.maxn : this.idx_max_bitmap_n;
        this.idx_max_bitmap_z       = this.maxz !=   8 ? this.maxz : this.idx_max_bitmap_z;
        this.idx_datecheck_enable   = this.idx_datecheck_enable  && this.date;
        this.idx_lazyload_detail    = this.idx_lazyload_detail   && this.ll;
        this.idx_lazyload_dim       = this.idx_lazyload_dim      && this.lldim;
        this.img_io_canvas_enable  |= this.ctx;
        this.img_fx_unshadow       |= this.unshd;
        this.img_fx_unstroke       |= this.unstr;
        this.img_ch_offset         |= this.choff;
        this.img_alpha_threshold   |= this.alpha;
    }
    
    LBITSOptions.prototype.i2b = function(x)
    {
        return x == null ? x : x == 0 ? false : true;
    };
    
    /*
    function Help()
    {
        var help = [
         "net_multithreading    (bool) [true|false] -- Dispatches HTTP GET->PNG->bitmap to background web worker thread."
        ,"net_worker_inc0_url  (char*)        [URL] -- Absolute URL to modded png.js, zlib.js, and/or bitstore.js for background web worker."
        ,"net_worker_inc1_url  (char*)        [URL] -- Absolute URL to modded png.js, zlib.js, and/or bitstore.js for background web worker."
        ,"net_worker_inc2_url  (char*)        [URL] -- Absolute URL to modded png.js, zlib.js, and/or bitstore.js for background web worker."
        ,"net_cache_enable      (bool) [true|false] -- Enables localStorage cache of bitstore data."
        ,"net_src_png_format    (bool) [true|false] -- Use a PNG's alpha channel as a data source."
        ,"net_src_hex_format    (bool) [true|false] -- Exclusive of io_src_png_format.  Use hex string index/value pairs as data"
                                                       + " source. See caching functions for format specifics."
        ,"net_url_append_enable (bool) [true|false] -- Append ?d=<daysSince1970> to all HTTP URLs to defeat caching."
        ,"idx_max_bitmap_n       (int)  [0...  n]   -- Max number of bitmap indices to create for this layer.  Recommend 256."
        ,"idx_max_bitmap_z       (int)  [0... 23]   -- Max zoom level of tiles to create indices from.  Recommend 6."
        ,"idx_datecheck_enable  (bool) [true|false] -- Caches the HTTP header last-modified date/time for the master index tile,"
                                                       + " for both reuse elsewhere and expiring cache."
        ,"idx_lazyload_detail   (bool) [true|false] -- Only load master index tile immediately.  Load rest when needed.  Not recommended."
        ,"idx_lazyload_dim      (bool) [true|false] -- Only load master index tile immediately.  Load rest after first use."
        ,"img_io_canvas_enable  (bool) [true|false] -- Use HTML5 Canvas instead of libpng/zlib.  Slower but don't need another script."
        ,"img_fx_unshadow       (bool) [true|false] -- PNG, specialized.  Sets the alpha channel value to 0 if the RGB values are" 
                                                       + " all 0.  Prevents false positives if pure black in the original raster has a"
                                                       + " non-zero alpha value and does not represent actual data points."
        ,"img_fx_unstroke       (bool) [true|false] -- PNG, specialized.  Removes ~90% of the effects of a 2x2 NODATA fill"
                                                       + " / neighboorhood mean function to prevent false positives." 
                                                       + " Slow, 3-pass scalar implementation."
        ,"img_ch_offset          (int)  [0...  3]   -- PNG, specialized.  For using another color channel instead of the alpha channel."
        ,"img_alpha_threshold    (int)  [0...255]   -- PNG, specialized.  Any alpha pixel this value or above will be considered data."
        ];
        return help;
    }
    */
    
    return LBITSOptions;
})();


var LBITS = (function() 
{
//- (void)
    function LBITS(layerId, minZ, maxZ, urlTemplate, x, y, options, dateStringCallback)
    {
        this.layerId                 = layerId;         //  int32_t
        this.minZ                    = minZ;            //  int32_t
        this.maxZ                    = maxZ;            //  int32_t
        
        this.urlTemplate             = urlTemplate;     // const char*
        
        this.bitstores               = new Array();     // NSMutableArray*
        this.extent                  = null;            // uint32_t*
                                                        // Extent is pixel x/y at zoom level 23, and is
                                                        // similar to an Apple MKMapRect (which is fractional z=20)

        this.lastModified            = null;            // const char*
        this.lastModifiedUnix        = 0;               // uint16_t - days since 1970
        this.isReady                 = false;           // bool
        
        this._hasCompleteSingleIndex = false;           // bool
        this._didLazyLoad            = false;           // bool
        this._defExZ                 = BITS.c_GetDefaultExtentZoomLevel();             // uint32_t
        
        var d = new Date();
        this._url_cache_append        = "?d=" + Math.round(d.getTime() / 86400000.0);  // const char*

        // ** options **
        this.net_multithreading      = false;
        this.net_worker_inc0_url     = null;
        this.net_worker_inc1_url     = null;
        this.net_worker_inc2_url     = null;
        
        this.net_cache_enable        = true;
        this.net_src_png_format      = true;
        this.net_src_hex_format      = false;
        this.net_url_append_enable   = true;

        this.idx_max_bitmap_n        = 256;
        this.idx_max_bitmap_z        = 8;
        this.idx_datecheck_enable    = true;
        this.idx_lazyload_detail     = true;
        this.idx_lazyload_dim        = true;
        
        this.img_io_canvas_enable    = false;

        this.img_fx_unshadow         = false;
        this.img_fx_unstroke         = false;
        this.img_ch_offset           = 3;
        this.img_alpha_threshold     = 1;
  
        // temp / constructor only
        var has_libpng       =  this.Has_libpng(); 
        var requested_libpng = false;
        var requested_multi  = false;
               
        if (!has_libpng) this.img_io_canvas_enable = true;
        
        
        if (options != null)
        {
            this.net_multithreading     =      options.net_multithreading 
                                          &&  !options.img_io_canvas_enable
                                          && has_libpng
                                          && (!options.idx_lazyload_detail || options.idx_lazyload_dim)
                                          && (   options.net_worker_inc0_url != null 
                                              || options.net_worker_inc1_url != null 
                                              || options.net_worker_inc2_url != null);
            this.net_worker_inc0_url    = options.net_worker_inc0_url;
            this.net_worker_inc1_url    = options.net_worker_inc1_url;
            this.net_worker_inc2_url    = options.net_worker_inc2_url;
            
            this.net_cache_enable       = options.net_cache_enable;
            this.net_src_png_format     = options.net_src_png_format;
            this.net_src_hex_format     = options.net_src_hex_format;
            this.net_url_append_enable  = options.net_url_append_enable;

            this.idx_max_bitmap_n       = options.idx_max_bitmap_n;
            this.idx_max_bitmap_z       = options.idx_max_bitmap_z;
            this.idx_datecheck_enable   = options.idx_datecheck_enable;
            this.idx_lazyload_detail    = options.idx_lazyload_detail || options.idx_lazyload_dim;
            this.idx_lazyload_dim       = options.idx_lazyload_dim;
        
            this.img_io_canvas_enable   = options.img_io_canvas_enable || !has_libpng;

            this.img_fx_unshadow        = options.img_fx_unshadow;
            this.img_fx_unstroke        = options.img_fx_unstroke;
            this.img_ch_offset          = options.img_ch_offset;
            this.img_alpha_threshold    = options.img_alpha_threshold;
            
            requested_libpng            = !options.img_io_canvas_enable;
            requested_multi             = options.net_multithreading;
        }//if
                
        if (requested_multi && !this.net_multithreading && this._log)
        {
            var reason;
            
            if (this.net_worker_inc0_url == null && this.net_worker_inc1_url == null && this.net_worker_inc2_url == null)
            {
                reason = "No include(s) specified.  You must specify a modified png.js that removes the window and document dependencies, zlib.js, and bitstores.js.";
            }
            else if (!has_libpng)
            {
                reason = "libpng / png.js not present.  Canvas cannot run outside the main thread.";
            }
            else if (options.idx_lazyload_detail && !options.idx_lazyload_dim)
            {
                reason = "Full lazy load mode specified. This is not supported.";
            }
            else
            {
                reason = "Reason(s) unknown.";
            }
            
            console.log("LBITS: [%d] init: Warning: Requested multithreading not enabled.  Reason: %s", this.layerId, reason);
        }//if
        
        if (requested_libpng && !has_libpng && this._log)
        {
            console.log("LBITS: [%d] init: Warning: Requested libpng aka png.js not found.  Using HTML5 Canvas fallback with degraded performance.", this.layerId);
        }//if
        
        this._log             = false;
        this._wantedForceLoad = false;
        this._worker          = null;
        this._worker_blob     = null;
        this._worker_blobURL  = null;
        
        if (this.net_multithreading)
        {
            this.CreateWorker();
        }//if        
        
        if (this._log) console.log("LBITS: [%d] init: layerId=%d, minZ=%d, maxZ=%d, x=%d, y=%d, urlTemplate=%s.  Getting master...", this.layerId, layerId, minZ, maxZ, x, y, urlTemplate);
        
        if (this.urlTemplate != null)
        {
            if (this.idx_datecheck_enable)
            {
                this.GetLastModifiedHeaderAsync(this.GetTileURL(x, y, this.minZ), x, y, this.minZ, dateStringCallback);
            }//if
            else
            {
                this.GetAsync_Any(x, y, this.minZ, true);
            }//else
        }//if
    }
    
    LBITS.prototype.Has_libpng = function()
    {
        var has_libpng = false;
    
        try
        {
            has_libpng = PNG != null;
        }//try
        catch(err)
        {
            has_libpng = false;
        }//catch
        
        return has_libpng;
    };
    
    
    
//- (void)  Called from constructor only.  Creates background worker if enabled with some safeties for invalid setup.
    LBITS.prototype.CreateWorker = function()
    {
        var url = "" + document.location.href;
        
        if (url.indexOf('http') == -1)
        {
            var index;
            index = url.indexOf('test_local.html');
            if (index != -1) url = url.substring(0, index);
            index = url.indexOf('index.html');
            if (index != -1) url = url.substring(0, index); // hack for local testing
        }//if
        
        var startInc = "importScripts('";
        var endInc   = "');";

        if (this.net_worker_inc0_url != null && this.net_worker_inc0_url.indexOf("/") == -1) this.net_worker_inc0_url = url + this.net_worker_inc0_url;
        if (this.net_worker_inc1_url != null && this.net_worker_inc1_url.indexOf("/") == -1) this.net_worker_inc1_url = url + this.net_worker_inc1_url;
        if (this.net_worker_inc2_url != null && this.net_worker_inc2_url.indexOf("/") == -1) this.net_worker_inc2_url = url + this.net_worker_inc2_url;
        
        var inc0 = this.net_worker_inc0_url == null ? null : startInc + this.net_worker_inc0_url + endInc;
        var inc1 = this.net_worker_inc1_url == null ? null : startInc + this.net_worker_inc1_url + endInc;
        var inc2 = this.net_worker_inc2_url == null ? null : startInc + this.net_worker_inc2_url + endInc;
        
        var sauce;
        
        sauce = "self.onmessage = function(e)"
              + "{"              
              +     "if (e.data.op == 'INCLUDE') "
              +     "{"
              +         "self.exec_include(e);"
              +     "}"
              +     "else if (e.data.op == 'GET_BITS')"
              +     "{"
              +         "var cb = function(response, userData)"
              +         "{"
              +             "var rgba   = LBITS.GetNewRGBA8888_FromPNG_libpng(response);"
              +             "var bs_u16 = BITS.GetBitmapFromRGBA8888Tile(rgba, userData[4], userData[5], userData[6], userData[7]);"
              +             "self.postMessage({op:e.data.op, user:userData, ab:bs_u16.buffer}, [bs_u16.buffer]);"
              +         "};"
              +         "LBITS.GetAsync_HTTP(e.data.url, 'arraybuffer', null, cb, e.data.userData); "
              +     "}"
              +     "else if (e.data.op == 'GET_BITS_IV')"
              +     "{"
              +         "var cb = function(response, userData)"
              +         "{"
              +             "var rgba   = LBITS.GetNewRGBA8888_FromPNG_libpng(response);"
              +             "var bs_u16 = BITS.GetBitmapFromRGBA8888Tile(rgba, userData[4], userData[5], userData[6], userData[7]);"
              +             "var ivs    = BITS.c_DecomposeIndexIntoIV(bs_u16);"
              +             "self.postMessage({op:e.data.op, ivs0:ivs[0], ivs1:ivs[1], user:userData, ab:bs_u16.buffer}, [bs_u16.buffer]);"
              +         "};"
              +         "LBITS.GetAsync_HTTP(e.data.url, 'arraybuffer', null, cb, e.data.userData); "
              +     "}"
              +     "else if (e.data.op == 'GET_BITS_IV_E')"
              +     "{"
              +         "var cb = function(response, userData)"
              +         "{"
              +             "var rgba   = LBITS.GetNewRGBA8888_FromPNG_libpng(response);"
              +             "var bs_u16 = BITS.GetBitmapFromRGBA8888Tile(rgba, userData[4], userData[5], userData[6], userData[7]);"
              +             "var ivs    = BITS.c_DecomposeIndexIntoIV(bs_u16);"
              +             "var ex_u32 = BITS.c_GetPixelExtentFromBitstore(bs_u16, userData[0],userData[1],userData[2]);"
              +             "self.postMessage({op:e.data.op, ivs0:ivs[0], ivs1:ivs[1], user:userData, ab:bs_u16.buffer, ex:ex_u32.buffer}, [bs_u16.buffer, ex_u32.buffer]);"
              +         "};"
              +         "LBITS.GetAsync_HTTP(e.data.url, 'arraybuffer', null, cb, e.data.userData); "
              +     "}"
              +     "else if (e.data.op == 'IV_BITS_E')"
              +     "{"
              +         "var bs_u16 = LBITS.DecodeBitmapIndexFromHexString(e.data.userData[4], null);"
              +         "e.data.userData[4] = null;"
              +         "var ex_u32 = BITS.c_GetPixelExtentFromBitstore(bs_u16, e.data.userData[0], e.data.userData[1], e.data.userData[2]);"
              +         "self.postMessage({op:e.data.op, user:e.data.userData, ab:bs_u16.buffer, ex:ex_u32.buffer}, [bs_u16.buffer, ex_u32.buffer]);"
              +     "}"
              + "};"
              
              + "self.exec_include = function(e)"
              + "{"
              +     "try"
              +     "{"
              +          (inc0 != null ? inc0 : "")
              +          (inc1 != null ? inc1 : "")
              +          (inc2 != null ? inc2 : "")
              +     "}"
              +     "catch(err)"
              +     "{"
              +         "self.postMessage({op:e.data.op});"
              +     "}"
              + "};";
        
        try
        {
            this._worker_blob    = new Blob([sauce]);
            this._worker_blobURL = window.URL.createObjectURL(this._worker_blob);
            this._worker         = new Worker(this._worker_blobURL);
            
            // set a callback function allowing for the worker to HTTP GET
            // a PNG, and convert it to a uint16_t* bitmap index buffer.
            this._worker.onmessage = function(e) 
            {
                if (e.data.op == "GET_BITS" || e.data.op == "GET_BITS_IV" || e.data.op == "GET_BITS_IV_E" || e.data.op == "IV_BITS_E")
                {
                    var userData = e.data.user;
                    var bits     = new Uint16Array(e.data.ab);
                    var needExt  = true;
                    
                    if (e.data.ivs0 != null && e.data.ivs1 != null) // GET_BITS_IV, GET_BITS_IV_E
                    {
                        this.StorageSet(this.GetStorageKey(userData[0], userData[1], userData[2]), e.data.ivs0, e.data.ivs1);
                    }//if
                    else if (this.net_cache_enable && e.data.op == "GET_BITS")
                    {
                        var ivs = BITS.c_DecomposeIndexIntoIV(bits);
                        this.StorageSet(this.GetStorageKey(userData[0],userData[1],userData[2]), ivs[0], ivs[1]);  
                    }//else if
                    
                    if (e.data.ex != null) //GET_BITS_IV_E, IV_BITS_E
                    {
                        needExt    = false;
                        var px_ext = new Uint32Array(e.data.ex);
                        this.UpdateLayerExtentFromBitstorePixelExtent(px_ext);
                    }//if
                    
                    this.AddBitstoreFromBitmapIndex(bits, userData[0], userData[1], userData[2], userData[3], needExt);
                }//if
                else if (e.data.op == "INCLUDE")
                {
                    console.log("LBITS.CreateWorker: [%d] ERR: Worker thread could not load png.js, zlib.js and/or bitstore.js.  Multithreading disabled.", this.layerId);
                    this.net_multithreading = false;
                }//else if
            }.bind(this);
        
            this.WorkerDispatchAsync("INCLUDE", null, null);
        }//try
        catch(err)
        {
            console.log("LBITS.CreateWorker: [%d] ERR: An unknown fatal error occurred while creating the worker. Multithreading disabled.", this.layerId);
            this.net_multithreading = false;
        }//catch
    };
    
//- (void)
    LBITS.prototype.WorkerDispatchAsync = function(op, url, userData)
    {
        this._worker.postMessage({op:op, url:url, userData:userData});
    };
    
    
    
    
    
// ******************************************************************************************************
// LBITS -- Indexing
// ******************************************************************************************************

//- (BITS*)
    LBITS.prototype.FindBitstoreWithXYZ = function(x, y, z)
    {
        var bs = null;
    
        for (var i=0; i<this.bitstores.length; i++)
        {
            if (   (x == -1 || this.bitstores[i].x == x)
                && (y == -1 || this.bitstores[i].y == y)
                &&             this.bitstores[i].z == z)
            {
                bs = this.bitstores[i];
                break;
            }//if
        }//for
            
        return bs;
    };
    
    
//- (bool)  This is intended to crudely help get all the lazy loaded indices loaded for a visualization demo.  It may need to be called multiple times.
    LBITS.prototype.VisualizationReady = function()
    {
        if (!this.idx_lazyload_detail && this.bitstores.length > 0) return true;
        
        for (var i=0; i<this.bitstores.length; i++)
        {
            if (!this.bitstores[i].isReady) return false;
        }//for
    
        return true;
    };
    
//- (void)
    LBITS.prototype.FinishLazyLoadInit = function()
    {
        if (this.idx_lazyload_detail && !this._didLazyLoad && this.bitstores.length > 0)
        {
            if (this._log) console.log("LBITS.ShouldLoadTile: [%d] Lazily loading rest of indices...", this.layerId);
            this._didLazyLoad = true;
            this.AddAllDefaultBitstores();
        }//if
        else if (this.bitstores.length == 0)
        {
            if (this.idx_lazyload_detail)
            {
                this._wantedForceLoad = true;
            }//if
            
            if (this._log) console.log("LBITS.ShouldLoadTile: [%d] Can't lazy load, no master yet.", this.layerId);
        }//else if
    };
    
//- (void)
    LBITS.prototype.ForceLoadHusks = function()
    {
        var didSomething = false;
    
        if (this.idx_lazyload_detail && !this.idx_lazyload_dim && this.bitstores.length > 0)
        {
            var neededProc = false;
            
            for (var i=0; i<this.bitstores.length; i=(i+1)|0)
            {
                var bs = this.bitstores[i];
                
                if (bs.needGet && !bs.getting)
                {
                    bs.getting = true;
                    this.GetAsync_Any(bs.x, bs.y, bs.z, false);
                    didSomething = true;
                }//if
                    
                neededProc = bs.needProc;
                
                if (bs.needProc)
                {
                    if (bs.tempData == null) if (this._log) console.log("LBITS.ForceLoadHusks: [%d] BITS wanted proc but no temp buffer.", this.layerId);
                
                    neededProc   = true;
                    bs.needProc  = false;
                    bs.SetBitmapFromCachedRGBA8888();
                    bs.tempData  = null;
                    didSomething = true;
                }//if
                
                if (neededProc && !bs.needProc)
                {
                    var ivs = bs.DecomposeIndexIntoIV();
                    if (ivs != null) this.StorageSet(this.GetStorageKey(bs.x, bs.y, bs.z), ivs[0], ivs[1]);
                }//if
            }//for
        }//if
        
        return didSomething;
    };
    

    

//- (bool)
    LBITS.prototype.ShouldLoadTile = function(layerId, x, y, z, extent_u32)
    {
        var shouldLoad = true;
        
        if (this.layerId == layerId && this.isReady)
        {
            if (this.idx_lazyload_detail && !this._didLazyLoad) { this.FinishLazyLoadInit(); }//if // z > this.minZ + 8
        
            shouldLoad = this.minZ <= z && z <= this.maxZ && x >= 0 && y >= 0 && x < (1<<z) && y < (1<<z) && this.IsTileInExtent(x, y, z, extent_u32);
            
            var neededProc = false;
            var bs         = null;
            
            for (var i=0; i<this.bitstores.length; i=(i+1)|0)
            {
                bs = this.bitstores[i];
            
                //<LazyLoad>
                if (this.idx_lazyload_detail && !this.idx_lazyload_dim)
                {                
                    if (bs.needGet && !bs[i].getting && bs[i].CanIndexTile(x, y, z, extent_u32))
                    {
                        bs.getting = true;
                        this.GetAsync_Any(bs.x, bs.y, bs.z, false);
                        return true; // this is why lazy loading everything isn't a good idea.
                    }//if
                    
                    neededProc = bs.needProc;
                }//if
                //</LazyLoad>
            
                shouldLoad = shouldLoad && bs.ShouldLoadTile(layerId,x,y,z, extent_u32);
            
                //<LazyLoad>
                if (this.idx_lazyload_detail && !this.idx_lazyload_dim)
                {
                    if (neededProc && !bs.needProc)
                    {
                        var ivs = bs.DecomposeIndexIntoIV();
                        this.StorageSet(this.GetStorageKey(bs.x, bs.y, bs.z), ivs[0], ivs[1]);
                    }//if
                }//if
                //</LazyLoad>
            
                if (!shouldLoad) break;
            }//for
        }//if
        
        return shouldLoad;
    };
    
    
//- (bool)
    LBITS.prototype.IsTileInExtent = function(x, y, z, extent_u32)
    {
        if (this.extent == null) return true;
        if (extent_u32  == null) extent_u32 = BITS.c_GetNewPxExtentVector_u32(x, y, z, this._defExZ);
        
        return !(   extent_u32[2] < this.extent[0] || extent_u32[0] > this.extent[2]
                 || extent_u32[3] < this.extent[1] || extent_u32[1] > this.extent[3]);
    };
    
    
    
    
    
    
//- (void)   either get the initial layer extent approximation from the master tile, or refine it with data from additional indices.
    LBITS.prototype.UpdateLayerExtentFromBitstorePixelExtent = function(px)
    {
        if (this.extent == null)
        {
            this.extent    = new Uint32Array(16); // hack: account for setting extent async with multiple z levels by tracking the z of each extent coord touch
            this.extent[0] = 0xFFFFFFFF; 
            this.extent[1] = 0xFFFFFFFF;
        }//if

        BITS.c_vPixelExtentToMercExtent_u32(px);

        if (px[5] >= this.extent[12]) { if (px[0] < this.extent[0]) { this.extent[0] = px[0]; this.extent[12] = px[5]; }
                                        if (px[2] < this.extent[0]) { this.extent[0] = px[2]; this.extent[12] = px[5]; } }
        if (px[5] >= this.extent[13]) { if (px[1] < this.extent[1]) { this.extent[1] = px[1]; this.extent[13] = px[5]; }
                                        if (px[3] < this.extent[1]) { this.extent[1] = px[3]; this.extent[13] = px[5]; } }
        if (px[5] >= this.extent[14]) { if (px[2] > this.extent[2]) { this.extent[2] = px[2]; this.extent[14] = px[5]; }
                                        if (px[0] > this.extent[2]) { this.extent[2] = px[0]; this.extent[14] = px[5]; } }
        if (px[5] >= this.extent[15]) { if (px[3] > this.extent[3]) { this.extent[3] = px[3]; this.extent[15] = px[5]; }
                                        if (px[1] > this.extent[3]) { this.extent[3] = px[1]; this.extent[15] = px[5]; } }
    };    
    
    



// ******************************************************************************************************
// LBITS -- Creation -- BIT Creation
// ******************************************************************************************************

//- (void)
    LBITS.prototype.AddBitstoreHusk = function(x, y, z)
    {
        var bs = new BITS(this.layerId, x, y, z, null, false);
        this.bitstores.push(bs);
        bs.needGet = true;
        bs.getting = false;
        bs.img_fx_unshadow     = this.img_fx_unshadow;
        bs.img_fx_unstroke     = this.img_fx_unstroke;
        bs.img_ch_offset       = this.img_ch_offset;
        bs.img_alpha_threshold = this.img_alpha_threshold;
    };

    
// ******************************************************************************************************
// LBITS -- Creation -- BIT Creation -- From Bitmap
// ******************************************************************************************************

    
//- (void)            Callback after cache hit
    LBITS.prototype.AddBitstoreFromBitmapIndex = function(bits, x, y, z, shouldAutoload, shouldUpdateExtent)
    {
        if (this.idx_lazyload_detail && !this.idx_lazyload_dim && z > this.minZ)
        {
            this.AddBitstoreFromBitmapIndex_WithLazyLoad(bits, x, y, z, shouldUpdateExtent);
        }//if
        else
        {
            this.AddBitstoreFromBitmapIndex_NoLazyLoad(bits, x, y, z, shouldUpdateExtent);
        }//else
        
        if (z == this.minZ && this._log) console.log("LBITS.AddBitstoreFromRGBA8888: [%d]: Added master bitstore.", this.layerId);

        if (shouldAutoload)
        {
            if (!this.idx_lazyload_detail || this._wantedForceLoad)
            {
                if (this._log) console.log("LBITS.AddBitstoreFromBitmapIndex: [%d] Autoloading rest of indices (if needed).", this.layerId);
                
                if (this._wantedForceLoad)
                {
                    this._didLazyLoad     = true;
                    this._wantedForceLoad = false;
                }//if
                
                this.AddAllDefaultBitstores();
            }//if
            
            this.isReady = true;
        }//if
    };
    
//- (void)
    LBITS.prototype.AddBitstoreFromBitmapIndex_NoLazyLoad = function(bits, x, y, z, shouldUpdateExtent)
    {
        var bs = new BITS(this.layerId, x, y, z, bits, true);
        this.bitstores.push(bs);
        
        if (shouldUpdateExtent)
        {
            var px_extent = bs.GetPixelExtentFromBitstore();
            this.UpdateLayerExtentFromBitstorePixelExtent(px_extent);
        }//if
        
        bs.isReady = true;
    };
    
//- (void)
    LBITS.prototype.AddBitstoreFromBitmapIndex_WithLazyLoad = function(bits, x, y, z, shouldUpdateExtent)
    {
        var bs = this.FindBitstoreWithXYZ(x,y,z);
        
        if (bs != null && bs.needGet && bs.getting)
        {
            bs.needGet = false;
            bs.getting = false;
            bs.data    = bits;
            
            if (shouldUpdateExtent && z == this.minZ)
            {
                var px_extent = bs.GetPixelExtentFromBitstore();
                this.UpdateLayerExtentFromBitstorePixelExtent(px_extent);
            }//if
            
            bs.isReady = true;
        }//if
    };
    
    
    

    
// ******************************************************************************************************
// LBITS -- Creation -- BIT Creation -- From RGBA8888
// ******************************************************************************************************    
    
//- (void)           Called after HTTP GET -> PNG -> RGBA8888
    LBITS.prototype.AddBitstoreFromRGBA8888 = function(rgba, x, y, z, shouldAutoload)
    {    
        if (this.idx_lazyload_detail && !this.idx_lazyload_dim && z > this.minZ)
        {
            this.AddBitstoreFromRGBA8888_WithLazyLoad(rgba, x, y, z);
        }//if
        else
        {
            this.AddBitstoreFromRGBA8888_NoLazyLoad(rgba, x, y, z);
        }//else
        
        if (z == this.minZ && this._log) console.log("LBITS.AddBitstoreFromRGBA8888: [%d]: Added master bitstore.", this.layerId);

        if (shouldAutoload)
        {
            if (!this.idx_lazyload_detail || this._wantedForceLoad)
            {
                if (this._log) console.log("LBITS.AddBitstoreFromRGBA8888: [%d] Autoloading rest of indices (if needed).", this.layerId);

                if (this._wantedForceLoad)
                {
                    this._didLazyLoad     = true;
                    this._wantedForceLoad = false;
                }//if

                this.AddAllDefaultBitstores();
            }//if
        
            this.isReady = true;
        }//if
    };
    

    
//- (void)
    LBITS.prototype.AddBitstoreFromRGBA8888_NoLazyLoad = function(rgba, x, y, z)
    {
        var bs = new BITS(this.layerId, x, y, z, null, false);
        this.bitstores.push(bs);
        bs.isReady = true;        
        
        bs.SetBitmapFromRGBA8888Tile(rgba, this.img_fx_unshadow, this.img_fx_unstroke, this.img_ch_offset, this.img_alpha_threshold);
            
        var px_extent = bs.GetPixelExtentFromBitstore();
        this.UpdateLayerExtentFromBitstorePixelExtent(px_extent);
        
        this.AddBitstoreToLocalCache(bs);
    };
    
    
//- (void)
    LBITS.prototype.AddBitstoreFromRGBA8888_WithLazyLoad = function(rgba, x, y, z)
    {
        var bs = this.FindBitstoreWithXYZ(x,y,z);
        
        if (bs != null && bs.needGet && bs.getting)
        {
            bs.needGet  = false;
            bs.getting  = false;
            bs.isReady  = true;
            bs.tempData = rgba;
            bs.needProc = true; 
        }//if
        else
        {
            if (this._log) console.log("LBITS.AddBitstoreFromRGBA8888: [%d] ERR: couldn't match lazyload (%d, %d) @ %d", this.layerId, x, y, z);
        }//else
    };
    
    
    
    
    
// ******************************************************************************************************
// LBITS -- Creation -- "Queries"
// ******************************************************************************************************
    
    
    
//- (void)            Do not use until z=0 bitstore is ready.
    LBITS.prototype.AddAllDefaultBitstores = function()
    {
        var sr = this.FindOptimalSingleIndex();
        
        if (sr != null && (sr[3] == 1 || this.idx_max_bitmap_n == 1))
        {
            this._hasCompleteSingleIndex = sr[3] == 1;
            
            if (sr[2] != 0)
            {
                if (this.idx_lazyload_detail && !this.idx_lazyload_dim) this.AddBitstoreHusk(sr[0], sr[1], sr[2]);
                                                                  else  this.GetAsync_Any(   sr[0], sr[1], sr[2], false);
            }//if
        }//if
        else
        {
            var multiResults = this.QueryMultiTXYs();
            
            if (multiResults != null && multiResults.length > 2 && multiResults[0] != null && multiResults[1] != null)
            {
                var mxs = multiResults[0], mys = multiResults[1], mz = multiResults[2];
            
                for (var i=0; i<mxs.length; i=(i+1)|0)
                {
                    if (mxs[i] != 0xFFFFFFFF)
                    {
                        if (this.idx_lazyload_detail && !this.idx_lazyload_dim) this.AddBitstoreHusk(mxs[i], mys[i], mz);
                                                                          else  this.GetAsync_Any(   mxs[i], mys[i], mz, false);
                    }//if
                }//for
            }//if
            else
            {
                if (this._log) console.log("LBITS.AddAllDefaultBitstores: [%d] multiResults were NULL.", this.layerId);
            }//else
        }//if
    };


    
//- (NSMutableArray*)     // Finds a single index tile for 100% of the dataset.  Dataset/size resolution determines risk of false positives.
    LBITS.prototype.FindOptimalSingleIndex = function()
    {
        var _xOut=0,_yOut=0,_zOut=0,_isComplete=true;
    
        if (this.maxZ > 8)                      // Hard way: see if entire extent fits into some nice little tile somewhere.
        {
            var newZ,i,px0,px1,py0,py1,px_extent=null;
            var bs = this.FindBitstoreWithXYZ(-1, -1, this.minZ);
            
            if (bs != null)
            {
                px_extent = bs.GetPixelExtentFromBitstore();
                BITS.c_vPixelExtentToMercExtent_u32(px_extent); // use actual pixel extent instead of gross tile extent
            }//if

            newZ        = this.maxZ - 8;
            _isComplete = false;
            
            if (px_extent == null) newZ = -9000;
            
            var diff, bestDiff = 0xFFFFFFFF;
        
            // Iterate through and attempt extent matches... this allows for a "not 1:1, but better than z=0" result.
            for (i = newZ; i > this.minZ; i--)
            {
                px0 = BITS.c_MercXZtoMercXZ(px_extent[0], px_extent[4], i);
                py0 = BITS.c_MercXZtoMercXZ(px_extent[1], px_extent[4], i);
                px1 = BITS.c_MercXZtoMercXZ(px_extent[2], px_extent[4], i);
                py1 = BITS.c_MercXZtoMercXZ(px_extent[3], px_extent[4], i);
                                
                if (px1 - px0 < 256 && py1 - py0 < 256)
                {
                    _xOut       = px0 >>> 8;
                    _yOut       = py0 >>> 8;
                    _zOut       = i;
                    _isComplete = this.maxZ - i <= 8;
                    break;
                }//if
                else
                {
                    diff = Math.sqrt((px1 - px0) * (px1 - px0) + (py1 - py0) * (py1 - py0)); // pythag
                    
                    if (diff < bestDiff)
                    {
                        bestDiff = diff;
                        _xOut    = px0 >>> 8;
                        _yOut    = py0 >>> 8;
                        _zOut    = i;
                        //if (this._log) console.log("LBITS.FindOptimalSingleIndex: -- [%d] [%d] Diff: %d ... Best: %d... (pxD: %d, pyD: %d)... (%d, %d - %d, %d)", this.layerId, i, diff, bestDiff, px1-px0, py1-py0, px0, py0, px1, py1);
                    }//if
                }//else
            }//for
        }//else
        
        if (_zOut == 0) if (this._log) console.log("LBITS.FindOptimalSingleIndex: [%d] Unable to find better match than existing master index.", this.layerId);
                   else if (this._log) console.log("LBITS.FindOptimalSingleIndex: [%d] %s match found. : (%d, %d) @ %d", this.layerId, _isComplete ? "Perfect" : "Best possible", _xOut, _yOut, _zOut);
    
        return [_xOut, _yOut, _zOut, (_isComplete ? 1 : 0)];
    };
    

    
//- (NSMutableArray*)
    LBITS.prototype.QueryMultiTXYs = function()
    {
        var xs = null, ys = null, uberX = 0, uberY = 0;//, destXs = null, destYs = null;
        var destZ  = this.QueryMultiTXYs_GetInitialDestZ();
        var xyPack = this.GetXYZsForBitstore_GetMasterTileXYsAndOrigin();
        
        if (destZ < 0 || xyPack == null)
        {
            return null;
        }//if

        xs    = xyPack[0];
        ys    = xyPack[1];
        uberX = xyPack[2];
        uberY = xyPack[3];
        
        var unique_n = 0xFFFFFFFF;
        var txs      = xs != null ? new Uint32Array(xs.length) : null;
        var tys      = ys != null ? new Uint32Array(ys.length) : null;
        
        // Loop until max n constraint is met; better resulets with a full extent at a lower resolution.
        while (unique_n > this.idx_max_bitmap_n && destZ > this.minZ+1)
        {
            unique_n = this.QueryMultiTXYs_DistinctTXYsforPXYs(uberX,uberY,xs,ys,txs,tys,destZ);

            if (unique_n <= this.idx_max_bitmap_n || destZ <= this.minZ+1) 
            {
                break;
            }//if
            else
            {
                if (this._log) console.log("LBITS.QueryMultiTXYs: [%d] Distinct tiles: %d > %d @ %d.  Retrying @ %d.", this.layerId, unique_n, this.idx_max_bitmap_n, destZ-1);
            }//else

            destZ--;
        }//while
        
        if (txs != null)
        {
            xs.set(txs); 
            ys.set(tys);
        }//if
        
        return [xs, ys, destZ];
    };
    
//- (int32_t)
    LBITS.prototype.QueryMultiTXYs_GetInitialDestZ = function()
    {
        var destZ = this.maxZ >= 8 ? this.maxZ - 8 : 0;
        
        if (this.hasCompleteSingleIndex || this.maxZ <= 8)
        {
            if (this._log) console.log("LBITS.QueryMultiTXYs: [%d] Already indexed, nothing to do.  Abort.", this.layerId);
            destZ = -1;
        }//if
        
        if (this.idx_max_bitmap_n == 1)
        {
            if (this._log) console.log("LBITS.QueryMultiTXYs: [%d] One tile, nothing to do.  Abort.", this.layerId);
            destZ = -1;
        }//if
        
        if (destZ > this.idx_max_bitmap_z)
        {
            if (this._log) console.log("LBITS.QueryMultiTXYs: [%d] Clamping destZ=%d to max idx z=%d.", this.layerId, destZ, this.idx_max_bitmap_z);
            destZ = this.idx_max_bitmap_z;
        }//if
        
        if (destZ > -1 && this._log)
        {
            console.log("LBITS.QueryMultiTXYs: [%d] Synthesizing list of tile x,y @ autoselected z=%d", this.layerId, destZ);
            console.log("LBITS.QueryMultiTXYs: [%d] - Searching %d indices for master...", this.layerId, this.bitstores.length);
        }//if
        
        return destZ;
    };
    
//- (NSMutableArray*)
    LBITS.prototype.GetXYZsForBitstore_GetMasterTileXYsAndOrigin = function()
    {
        var bs = this.FindBitstoreWithXYZ(-1,-1,this.minZ);
        var ox, oy, xs, ys;
    
        if (bs != null)
        {
            ox = (bs.x << 8)|0; 
            oy = (bs.y << 8)|0;
            var xys = bs.DecomposeIndexIntoXY();
            xs = xys[0]; 
            ys = xys[1];
            if (this._log) console.log("LBITS.QueryMultiTXYs: [%d] -- Master (%d, %d) @ %d decomposed into %d elements.", this.layerId, ox, oy, this.minZ, xys != null && xys[0] != null ? xys[0].length : -1);
        }//if
        
        return bs != null ? [xs, ys, ox, oy] : null;
    };

//- (size_t)
    LBITS.prototype.QueryMultiTXYs_DistinctTXYsforPXYs = function(originpx, originpy, pxs, pys, txs, tys, destZ)
    {
        var i,j,shrn = (((this.minZ+8)|0)-destZ)|0, distinct_n=0;

        if (this._log) console.log("LBITS.SelectDistinctTXYforPXY: [%d] pxy@%d is txy@%d.  Need txy @ %d.  So must >>= %d.  Reprojecting...", this.layerId, this.minZ, this.minZ+8, destZ, shrn);

        // translate coordinates
        for (i=0; i<pxs.length; i=(i+1)|0)
        {
            txs[i] = (((originpx + pxs[i])|0) >>> shrn)|0; 
            tys[i] = (((originpy + pys[i])|0) >>> shrn)|0;
        }//for
        
        // count distinct, overwrite dupes with UINT32_MAX
        for (i=0; i<(txs.length-1)|0; i=(i+1)|0)
        {
            if (txs[i] != 0xFFFFFFFF)
            {
                for (j=(i+1)|0; j<txs.length; j++)
                {
                    if (        destZ <= this.minZ+1 
                        && distinct_n >  this.idx_max_bitmap_n) 
                    {
                        txs[i] = 0xFFFFFFFF;
                        tys[i] = 0xFFFFFFFF;
                    }//if
                    else if (   txs[i] == txs[j] 
                             && tys[i] == tys[j]) 
                    { 
                        txs[j] = 0xFFFFFFFF; 
                        tys[j] = 0xFFFFFFFF; 
                    }//if
                }//for
                
                distinct_n++;
            }//if
        }//for
        
        return distinct_n;
    };




// ******************************************************************************************************
// LBITS -- Net / IO -- Key / URL Helpers
// ******************************************************************************************************

    
//- (const char*)
    LBITS.prototype.GetTileURL = function(x, y, z)
    {
        var urlCopy = "" + this.urlTemplate;
            urlCopy = urlCopy.replace(/{x}/g, ""+x);
            urlCopy = urlCopy.replace(/{y}/g, ""+y);
            urlCopy = urlCopy.replace(/{z}/g, ""+z);
               
        return this.net_url_append_enable ? urlCopy + this._url_cache_append : urlCopy;
    };//GetTileURL
    
    
//- (const char*)
    LBITS.prototype.GetStorageKey = function(x, y, z) 
    {
        return "bs_iv_vec_" + this.lastModifiedUnix + "_" + this.layerId + "_" + z + "_" + x + "_" + y + "_b16.txt";
    };
    
// ******************************************************************************************************
// LBITS -- Net / IO -- Data Source Get Abstraction Methods
// ******************************************************************************************************

//- (void)  Load or GET using any data source, then create BIT
    LBITS.prototype.GetAsync_Any = function(x, y, z, shouldAutoload)
    {
        var cache = null;
        
        if (this.net_cache_enable)
        {
            var ck = this.GetStorageKey(x, y, z);
            cache  = this.net_multithreading ? localStorage.getItem(ck) : this.StorageGet(ck);
        
            if (cache != null)
            {
                if (this.net_multithreading)
                {
                    this.WorkerDispatchAsync("IV_BITS_E", url, [x, y, z, shouldAutoload, cache]);
                }//if
                else
                {
                    this.AddBitstoreFromBitmapIndex(cache, x, y, z, shouldAutoload, true);
                }//else
            }//if
        }//if
        
        if (cache == null)
        {
            var url = this.GetTileURL(x, y, z);
            
            if (this.net_src_png_format)
            {
                if (!this.img_io_canvas_enable)
                {
                    if (this.net_multithreading)
                    {
                        var op = this.net_cache_enable ? "GET_BITS_IV_E" : "GET_BITS";
                        this.WorkerDispatchAsync(op, url, [x, y, z, shouldAutoload, this.img_fx_unshadow, this.img_fx_unstroke, this.img_ch_offset, this.img_alpha_threshold]);
                    }//if
                    else
                    {
                        this.AddAsync_PNG_URL_libpng(url, x, y, z, shouldAutoload);
                    }//else
                }//if
                else
                {
                    this.AddAsync_PNG_URL_Canvas(url, x, y, z, shouldAutoload);
                }//else
            }//if
            else
            {
                this.AddAsync_Hex_URL_Canvas(url, x, y, z, shouldAutoload);
            }//else
        }//if
    };
    
    
    
// ******************************************************************************************************
// LBITS -- Net / IO -- GET -> Add BIT
// ******************************************************************************************************

//- (void)      HTTP GET a PNG, then create BIT.  Uses and requires png.js and zlib.js.  Fastest method possible, works with CORS seamelessly.
    LBITS.prototype.AddAsync_PNG_URL_libpng = function(url, x, y, z, shouldAutoload)
    {
        var cubbyLlama = function(response, userData)
        {
            this.AddBitstoreFromRGBA8888(LBITS.GetNewRGBA8888_FromPNG_libpng(response), x, y, z, shouldAutoload);
        }.bind(this);
        
        LBITS.GetAsync_HTTP(url, "arraybuffer", null, cubbyLlama, null);
    };


//- (void)      HTTP GET a PNG, render to Canvas and extract bytes, then dispatch create BIT.  Uses HTML 5 Canvas + CORS.  Slowest method possible.
    LBITS.prototype.AddAsync_PNG_URL_Canvas = function(url, x, y, z, shouldAutoload)
    {
        var getCallback = function(response, userData)
        {
            var addCallback = function(rgba, userData)
            {
                this.AddBitstoreFromRGBA8888(rgba, x, y, z, shouldAutoload);
            }.bind(this);
            
            this.GetAsyncNewRGBA8888_FromPNG_Canvas(response, addCallback, userData);
        }.bind(this);
        
        LBITS.GetAsync_HTTP(url, "blob", null, getCallback, null);
    };


//- (void)      Probably will never be used, not much reason to load this from anything but local cache.
    LBITS.prototype.AddAsync_Hex_URL_Canvas = function(url, x, y, z, shouldAutoload)
    {
        var cubbyLlama = function(response, userData)
        {
            this.AddBitstoreFromBitmapIndex(LBITS.DecodeBitmapIndexFromHexString(response, null), x, y, z, shouldAutoload);
        }.bind(this);
        
        LBITS.GetAsync_HTTP(url, "text\/plain; charset=x-user-defined", null, cubbyLlama, null);
    };
    

// ******************************************************************************************************
// LBITS -- Net / IO -- GET -> Add BIT Helpers
// ******************************************************************************************************
    LBITS.prototype.GetAsyncNewRGBA8888_FromPNG_Canvas = function(srcBlob, fxCallback, userData)
    {
        var layerBS = this;
        var image   = new Image();
        var canvas  = document.createElement("canvas");
        var ctx     = canvas.getContext("2d");
        
        image.onload = function() 
        {                
            canvas.width  = image.width;
            canvas.height = image.height;
            
            ctx.drawImage(image, 0, 0);
            
            var ctxBuffer = ctx.getImageData(0, 0, canvas.width, canvas.height);

            window.URL.revokeObjectURL(image.src);
            
            fxCallback(ctxBuffer.data, userData);
        };
        
        image.src = window.URL.createObjectURL(srcBlob);
    };

    
// ******************************************************************************************************
// LBITS -- Net / IO -- Get Last-Modified Header
// ******************************************************************************************************

//- (const char*)       Unfortunately, cannot get both headers + binary data :(
    LBITS.prototype.GetLastModifiedHeaderAsync = function(url, x, y, z, dateStringCallback)
    {
        var cubbyLlama = function(response, userData)
        {
            if (response != null && response.length > 0)
            {
                var d = new Date(response);
                    
                if (d != null)
                {
                    this.lastModifiedUnix = Math.round(d.getTime() / 86400000.0);
                    this.lastModified     = d.toISOString().substring(0, 10);
                    if (this._log) console.log("LBITS.GetLastModifiedHeaderAsync: [%d] Last-Modified: %s", this.layerId, this.lastModified);
                    
                    if (dateStringCallback != null)
                    {
                        dateStringCallback(this.lastModified);
                    }//if
                    
                    if (this.net_cache_enable)
                    {
                        this.PurgeOldCacheForLayer();
                    }//if
                        
                    this.GetAsync_Any(x, y, z, true);
                }//if
            }//if
        }.bind(this);
        
        LBITS.GetAsync_HTTP(url, null, "Last-Modified", cubbyLlama, null);
    };


// ******************************************************************************************************
// LBITS -- Net / IO -- LocalStorage Wrappers with Conversion
// ******************************************************************************************************
    
//- (void)
    LBITS.prototype.StorageSet = function(key_iv, value_i, value_v) 
    {
        if (this.net_cache_enable) localStorage.setItem(key_iv, value_i+value_v);
    };

//- (uint16_t*)
    LBITS.prototype.StorageGet = function(key_iv) 
    {
        var    item  = !this.net_cache_enable ? null : localStorage.getItem(key_iv);
        return item == null ? null : LBITS.DecodeBitmapIndexFromHexString(item, null);
    };
    
//- (void)
    LBITS.prototype.AddBitstoreToLocalCache = function(bs)
    {
        if (bs != null && this.net_cache_enable)
        {
            var ivs = bs.DecomposeIndexIntoIV();
            if (this._log) console.log("LBITS.AddBitstoreToLocalCache: [%d] Setting cache: (%d, %d) @ %d.... %d len and %d len", this.layerId, x, y, z, ivs[0].length, ivs[1].length);
            this.StorageSet(this.GetStorageKey(bs.x, bs.y, bs.z), ivs[0], ivs[1]);  
        }//if
    };
    
//- (void)
    LBITS.prototype.PurgeOldCacheForLayer = function()
    {
        var  n = localStorage.length >>> 0;
        var ds = "" + this.lastModifiedUnix;
        var mb = this.GetStorageKey(0, 0, 0).substring(0, 10); // bs_iv_vec_
        var ls = this.layerId.toString();
        var le = (18 + ls.length) >>> 0;
        var key;
        
        // bs_iv_vec_12345_2_0_0_0_b16.txt
        // 0         1         2
        // 0123456789012345678901234567890
        
        for (var i=0; i<n; i++)
        {
            key = localStorage.key(i);
            
            if (   key.length > 20
                && key.substring( 0, 10) == mb
                && key.substring(16, le) == ls
                && key.substring(10, 15) != ds)
            {
                if (this._log) console.log("LBITS.PurgeOldCacheForLayer: [%d] Purging %d bytes: (%s)", this.layerId, localStorage[key].length<<1, key);
                
                localStorage.removeItem(key);
            }//if
        }//for
    };
    
// ******************************************************************************************************
// LBITS -- Class (Static) Methods -- Misc
// ******************************************************************************************************

//+ (void)      Generic HTTP GET wrapper.  Use null to specify header or response GET.  Invokes fxCallback(response, userData) upon success.
    LBITS.GetAsync_HTTP = function(url, responseType, responseHeader, fxCallback, userData)
    {
        var req = new XMLHttpRequest();
        req.open("GET", url, true);
    
        if (responseType != null)
        {
            if (responseType == "text\/plain; charset=x-user-defined")
            {
                req.overrideMimeType(responseType);
            }//if
            else
            {
                req.responseType = responseType;    //"arraybuffer", "blob", "document", "json", and "text"        
            }//else
        }//if
        
        req.onreadystatechange = function () // why was this ==== ?
        {
            if (req.readyState === 4 && req.status == 200 && req.response != null)
            {
                if (responseHeader != null)
                {
                    fxCallback(req.getResponseHeader(responseHeader), userData);
                }//if
                else
                {
                    fxCallback(req.response, userData);
                }//else
            }//if
        };
        
        req.send(null);
    };
    
    
//+ (uint8_t*)
    LBITS.GetNewRGBA8888_FromPNG_libpng = function(srcArrayBuffer)
    {
        var buf  = new Uint8Array(srcArrayBuffer);
        var png  = new PNG(buf);
        var rgba = png.decode();
        
        return rgba;
    };
    
    
// ******************************************************************************************************
// LBITS -- Class (Static) Methods -- Deserialized Text <-> Bitmap Index Conversion
// ******************************************************************************************************

//- (uint16_t*)         Accepts separate strings or a combined buffer in src_i_str with values following indices.
    LBITS.DecodeBitmapIndexFromHexString = function(src_i_str, src_v_str) 
    {
        var i_u16 = null, v_u16 = null;
        
        if (src_v_str != null)
        {
            i_u16 = LBITS.new_vhtoi_u16(src_i_str);
            v_u16 = LBITS.new_vhtoi_u16(src_v_str);
        }//if
        else
        {
            i_u16 = LBITS.new_vhtoi_u16(src_i_str.substring(0, src_i_str.length>>>1));
            v_u16 = LBITS.new_vhtoi_u16(src_i_str.substring(src_i_str.length>>>1, src_i_str.length));
        }//else
        
        return LBITS.new_ivtovec_u16(i_u16, v_u16, 4096);
    };

//- (uint16_t*)     New wrapper for ivtovec_u16
    LBITS.new_ivtovec_u16 = function(srci_u16, srcv_u16, n)
    {
        var dest_u16 = new Uint16Array(n);
        LBITS.ivtovec_u16(dest_u16, srci_u16, srcv_u16);
        return dest_u16;
    };
    
//- (void)      // sets elements in dest based upon indices into dest in srci and corresponding values in srcv
    LBITS.ivtovec_u16 = function(dest_u16, srci_u16, srcv_u16)
    {
        var i;
        var src_n = srci_u16.length >>> 0;
        var max_i = src_n - (src_n % 4);
    
        for (i = 0; i < max_i; i += 4)
        {
            dest_u16[srci_u16[i  ]] = srcv_u16[i  ];
            dest_u16[srci_u16[i+1]] = srcv_u16[i+1];
            dest_u16[srci_u16[i+2]] = srcv_u16[i+2];
            dest_u16[srci_u16[i+3]] = srcv_u16[i+3];
        }//for
        
        for (i = max_i; i < max_i + src_n % 4; i++)
        {
            dest_u16[srci_u16[i]] = srcv_u16[i];
        }//for
    };
    


//- (uint16_t*)     New wrapper for vhtoi_u16
    LBITS.new_vhtoi_u16 = function(src_str)
    {
        var dest_u16 = new Uint16Array(src_str.length >>> 2);
        LBITS.vhtoi_u16(dest_u16, src_str);
        return dest_u16;
    };
    
//- (void)      // sets values in uint16_t* buffer dest_u16 converted from string src_str of 4-char base-16 hex values
    LBITS.vhtoi_u16 = function(dest_u16, src_str)
    {
        var i;
        var dest_n = dest_u16.length >>> 0;
        var max_i  = dest_n - (dest_n % 4);
    
        for (i = 0; i < max_i; i += 4)
        {
            dest_u16[i  ] = parseInt(("0x" + src_str.substring( i    << 2, ( i    << 2)+4))); 
            dest_u16[i+1] = parseInt(("0x" + src_str.substring((i+1) << 2, ((i+1) << 2)+4))); 
            dest_u16[i+2] = parseInt(("0x" + src_str.substring((i+2) << 2, ((i+2) << 2)+4))); 
            dest_u16[i+3] = parseInt(("0x" + src_str.substring((i+3) << 2, ((i+3) << 2)+4)));
        }//for
        
        for (i = max_i; i < max_i + dest_n % 4; i++)
        {
            dest_u16[i] = parseInt(('0x' + src_str.substring(i << 2, (i << 2) + 4)));
        }//for
    };
    

    // **** END CLASS ****
    
    return LBITS;
})();



























// Bitmap indices collapse a 256x256 tile to a 64x64 tile with 16-bit cells.
//
// 1 bit per pixel is used to represent data, using 8 KB of RAM instead of 64 KB for one byte per pixel.
//
// Each uint16_t cell in the 64x64 bitmap index is 4x4 bits, relative to the original 256x256 tile.

// +--+--+    +==+--+
// |00|10| -> >00<40|                           dc   ba   a: cell "00" in 256x256
// +--+--+    +==+--+   >00< value: 0000 0000 0000 0000   b: cell "10" in 256x256
// |01|11|    |04|44|               ^^^^ ^^^^ ^^^^ ^^^^   c: cell "01" in 256x256
// +--+--+    +--+--+               row3 row2 row1 row0   d: cell "11" in 256x256
// 256x256     64x64


// BITS: Bitstore.  Holds the bitmap index itself (.data) and other associated data.  Has methods for R/W and other I/O.
var BITS = (function() 
{
//- (void)
    function BITS(layerId, x, y, z, data, isReady)
    {
        this.layerId  = layerId;         //  int32_t
        this.x        = x;               // uint32_t
        this.y        = y;               // uint32_t
        this.z        = z;               //  int32_t
        this.data     = data;            //  int16_t*
        this.isReady  = data != null || isReady;    //     bool
        this.tempData = null;            // uint8_t*
        this.needProc = false;           // bool
        this.needGet  = false;           // bool
        this.getting  = false;           // bool
        this._defExZ  = BITS.c_GetDefaultExtentZoomLevel();      // uint32_t
        this.extent   = null;            // uint32_t
        
        // &&& property copy to support lazy loads, usually can be null ***
        this.img_fx_unshadow         = false;   // bool
        this.img_fx_unstroke         = false;   // bool
        this.img_ch_offset           = 3;       // uint32_t
        this.img_alpha_threshold     = 1;       // uint32_t
        
        this._log                    = false;   // bool
        
        this.UpdateExtent();
    }



// ******************************************************************************************************
// BITS -- Indexing
// ******************************************************************************************************


    // main code entry point for use as an index.
    // returns true if indeterminate or if an index confirms this tile should be loaded.
    // returns false only if the load can be ruled out with 100% certainty.
    // eg: failure mode is only false positives, provided the index is correct.
    
//- (bool)
    BITS.prototype.ShouldLoadTile = function(layerId, x, y, z, extent_u32)
    {
        var shouldLoad = true;
    
        if (    this.isReady
            && !this.needGet
            &&  this.layerId == layerId 
            &&  this.z       <= z
            &&  this.CanIndexTile(x, y, z, extent_u32))
        {
            if (this.needProc)
            {
                this.FinishLazyLoad();
            }//if
            
            shouldLoad = this.DoesTileIntersectData(x, y, z);    
        }//if
    
        return shouldLoad;
    };
    
//- (void)
    BITS.prototype.FinishLazyLoad = function()
    {
        if (this.needProc)
        {
            if (this._log) console.log("BITS.ShouldLoadTile: Finishing load and processing RGBA data...");
            this.needProc = false;
            this.SetBitmapFromCachedRGBA8888();
            this.tempData = null;
        }//if
    };


    
//- (bool)  Extent check -- faster.  Does not check layerId.  Only valid for z >= this.z
    BITS.prototype.CanIndexTile = function(x, y, z, extent_u32)
    {
        if (extent_u32 == null) extent_u32 = BITS.c_GetNewPxExtentVector_u32(x, y, z, this._defExZ);

        return extent_u32[0] >= this.extent[0] && extent_u32[0] < this.extent[2] 
            && extent_u32[2] >= this.extent[0] && extent_u32[2] < this.extent[2]
            && extent_u32[1] >= this.extent[1] && extent_u32[1] < this.extent[3] 
            && extent_u32[3] >= this.extent[1] && extent_u32[3] < this.extent[3];
    };
    
    
//- (bool)  Bitmap index scan.  Does not check layerId.  Only valid for z >= this.z
    BITS.prototype.DoesTileIntersectData = function(x, y, z)
    {
        var retVal = false;
    
        // 1. Convert tile xy @ z to a pixel xy extent @ idxZ, offset to pixel xy origin of index tile
        var px0    = BITS.c_MercXZtoMercXZ(  (x << 8)|0,         z, this.z) - (this.x << 8)|0;
        var py0    = BITS.c_MercXZtoMercXZ(  (y << 8)|0,         z, this.z) - (this.y << 8)|0;
        var px1    = BITS.c_MercXZtoMercXZ((((x << 8)|0)+255)|0, z, this.z) - (this.x << 8)|0;
        var py1    = BITS.c_MercXZtoMercXZ((((y << 8)|0)+255)|0, z, this.z) - (this.y << 8)|0;
        var bitX;
        var bitIdx;

        // 3. For the pixels that intersect between the two rects, loop through and see if any of the bits are 1.
        for (var bitY = py0; bitY <= py1; bitY=(bitY+1)|0) 
        {
            for (bitX = px0; bitX <= px1; bitX=(bitX+1)|0) 
            {
                bitIdx = (((((bitY>>>2)|0)<<6)|0)+((bitX>>>2)|0))|0;
            
                if (    this.data[bitIdx] != 0         // has at least 1px on
                    && (this.data[bitIdx]  = 0xFFFF    // if all bits are on, obviously true
                    || (this.data[bitIdx]  & (1 << (((bitY-((bitY>>>2)<<2))<<2) + (bitX-((bitX>>>2)<<2))))) != 0)) // inlined
                {
                    retVal = true; break;
                }//if
            }//for
            if (retVal) break;
        }//for
        return retVal;
    };
    
    
    
// ******************************************************************************************************
// BITS -- Misc
// ******************************************************************************************************

    
//- (void)      Updates the bitstore instance's extent vector.  if null, creates a new one and retains the reference.
    BITS.prototype.UpdateExtent = function()
    {
        if (this.extent == null)
        {
            this.extent = BITS.c_GetNewPxExtentVector_u32(this.x, this.y, this.z, this._defExZ);
        }//if
        else
        {
            BITS.c_SetPxExtentVector_u32(v, this.x, this.y, this.z, this._defExZ);
        }//else
        
        this.extent[2] += 1; 
        this.extent[3] += 1; // compatibility with bad extent in iOS/OSX app (whoops)  
    };
    
//- (size_t)    http://en.wikipedia.org/wiki/Hamming_weight
    BITS.prototype.GetDataCount = function()
    {
        return BITS.c_GetDataCount(this.data);
    };
    
    



// ******************************************************************************************************
// BITS -- Bitmap Index R/W
// ******************************************************************************************************

//- (bool)  returns a boolean value indicating whether the pixel is on or off, for pixel x,y coordinates in a 256,256 tile
    BITS.prototype.GetBit = function(x,y)
    {
        return (this.data[(((((y>>>2)|0)<<6)|0)+((x>>>2)|0))|0] & (((1<<((((((y-((((y>>>2)|0)<<2)|0))|0)<<2)|0)+((x-((((x>>>2)|0)<<2)|0))|0))|0))|0)|0))|0 != 0;
    };
    
    
//- (bool)  same as above, but reuses a precalculated index to reduce ops
    BITS.prototype.GetBitReusingIdx = function(idx,x,y)
    {
        return (this.data[idx] & (((1<<((((((y-((((y>>>2)|0)<<2)|0))|0)<<2)|0)+((x-((((x>>>2)|0)<<2)|0))|0))|0))|0)|0))|0 != 0;
    };





// ******************************************************************************************************
// BITS -- Bitmap Index Creation
// ******************************************************************************************************
    
//- (void)  UNUSED   Sets/replaces the instance's bitmap index with one newly synthesized from a planar tile.
/*
    BITS.prototype.SetBitmapFromPlanarTile = function(src)
    {
        if (this._log) console.log("BITS.SetBitmapFromPlanarTile: Create bitmap from Planar8 src, %d bytes", src != null ? src.length : -1);
        if (src != null)
        {
            if (this.data == null) this.data = new Uint16Array(4096);
    
            var x, bsX = 0, bsY_64 = 0;
    
            for (var y = 0; y < 256; y = (y+4)|0)
            {
                bsX = 0;
        
                for (x = 0; x < 256; x = (x+4)|0)
                {
                    this.data[(bsY_64+bsX)|0] = BITS.GetBitmapCellFromPlanarTile_u16(src, x, y, 0, 1, 1);
                    bsX++;
                }//for
        
                bsY_64 = (bsY_64+64)|0;
            }//for
            
            this.isReady = true;
        }//if
    };
*/

//-(void)   Sets/replaces the instance's bitmap index with one newly synthesized from a RGBA8888 tile.
    BITS.prototype.SetBitmapFromRGBA8888Tile = function(src, unshadow, unstroke, ch_offset, alpha_threshold)
    {
        this.data = BITS.GetBitmapFromRGBA8888Tile(src, unshadow, unstroke, ch_offset, alpha_threshold);
    };
    
// ******************************************************************************************************
// BITS -- Bitmap Index I/O -- Output
// ******************************************************************************************************
    
//- (uint8_t*)  Returns a 256x256 Planar8 representation of the bitmap, with 1=data_u08 and 0=NODATA_u08
    BITS.prototype.GetNewPlanar8FromBitmap = function(data_u08, NODATA_u08)
    {
        return BITS.c_GetNewPlanar8FromBitmap(this.data, data_u08, NODATA_u08);
    };
    
    
//- (NSMutableArray*)   Returns two vectors of corresponding x and y pixel locations in a 256x256 tile for bits set to on.  x range: [0 ... 255], y range: [0 ... 255]
    BITS.prototype.DecomposeIndexIntoXY = function()
    {
        return BITS.c_DecomposeIndexIntoXY(this.data);
    };
    

//- (NSMutableArray*)   Returns two vectors of corresponding index/value pairs containing the actual data.  index range: [0 ... 4095], value range: [0 ... 65535]
    BITS.prototype.DecomposeIndexIntoIV = function()
    {
        return BITS.c_DecomposeIndexIntoIV(this.data);
    };
    
    
    
//              Used to iteratively refine extent of parent LBITS.
//- (int32_t*)  Returns the extent of the pixels, rather than the general tile boundaries.  Do *not* set a BIT's extent to this.
    BITS.prototype.GetPixelExtentFromBitstore = function()
    {
        return BITS.c_GetPixelExtentFromBitstore(this.data);
    };
    
    
    
    
    
// ******************************************************************************************************
// BITS -- Bitmap Index I/O -- Input
// ******************************************************************************************************

//- (void)
    BITS.prototype.SetBitmapFromCachedRGBA8888 = function()
    {
        if (this.tempData != null) 
        {
            this.SetBitmapFromRGBA8888Tile(this.tempData, this.img_fx_unshadow, this.img_fx_unstroke, this.img_ch_offset, this.img_alpha_threshold);
        }//if
    };



    // **************************************************************************************************************
    // ****************************************      CLASS (STATIC) FUNCTIONS      **********************************
    // **************************************************************************************************************

//+ (bool)  returns a boolean value indicating whether the pixel is on or off, for pixel x,y coordinates in a 256,256 tile
    BITS.c_GetBit = function(src_u16, x, y)
    {
        return (src_u16[(((((y>>>2)|0)<<6)|0)+((x>>>2)|0))|0] & (((1<<((((((y-((((y>>>2)|0)<<2)|0))|0)<<2)|0)+((x-((((x>>>2)|0)<<2)|0))|0))|0))|0)|0))|0 != 0;
    };
    
//+ (bool)  same as above, but reuses a precalculated index to reduce ops
    BITS.c_GetBitReusingIdx = function(src_u16, idx, x, y)
    {
        return (src_u16[idx] & (((1<<((((((y-((((y>>>2)|0)<<2)|0))|0)<<2)|0)+((x-((((x>>>2)|0)<<2)|0))|0))|0))|0)|0))|0 != 0;
    };


//+ (size_t)    http://en.wikipedia.org/wiki/Hamming_weight
    BITS.c_GetDataCount = function(src_u16)
    {
        var i,x,y,y_width,dc = 0;
        
        for (y=0; y<64; y=(y+1))
        {
            y_width = (y << 6)|0;
            
            for (x=0; x<64; x=(x+1)|0)
            {
                i = src_u16[(y_width+x)|0];
                
                for (i = i | 0; i > 0; i = i >>> 1) 
                {
                    if (i & 1) dc++;
                }//for
            }//for
        }//for
        
        return dc;
    };

//+ (NSMutableArray*)   Returns two vectors of corresponding x and y pixel locations in a 256x256 tile for bits set to on.  x range: [0 ... 255], y range: [0 ... 255]
    BITS.c_DecomposeIndexIntoXY = function(src_u16)
    {
        var dc         = BITS.c_GetDataCount(src_u16);
        var dest_x_u32 = new Uint32Array(dc);
        var dest_y_u32 = new Uint32Array(dc);
        var x,bitIdx,dest_i = 0;
        
        for (var y=0; y<256; y=(y+1)|0)
        {
            for (x=0; x<256; x=(x+1)|0)
            {
                bitIdx = (((((y>>>2)|0)<<6)|0)+((x>>>2)|0))|0;
            
                if ((src_u16[bitIdx] & (((1<<((((((y-((((y>>>2)|0)<<2)|0))|0)<<2)|0)+((x-((((x>>>2)|0)<<2)|0))|0))|0))|0)|0))|0 != 0) // inlined GetBit
                {
                    dest_x_u32[dest_i] = x;
                    dest_y_u32[dest_i] = y;
                    dest_i             = (dest_i+1)|0;
                }//if
            }//for
        }//for
        
        return [dest_x_u32, dest_y_u32];
    };


    BITS.c_GetPixelExtentFromBitstore = function(src_u16, x, y, z)
    {
        var x,y,y_256,dc=0,minX=32767,minY=32767,maxX=-32768,maxY=-32768,bitIdx;

        if (this.data != null) // not worth lazy loading
        {
            for (y=0; y<256; y=(y+1)|0)
            {
                y_256 = (y << 8)|0;
            
                for (x=0; x<256; x=(x+1)|0)
                {
                    bitIdx = (((((y>>>2)|0)<<6)|0)+((x>>>2)|0))|0;
                
                    if ((src_u16[bitIdx] & (((1<<((((((y-((((y>>>2)|0)<<2)|0))|0)<<2)|0)+((x-((((x>>>2)|0)<<2)|0))|0))|0))|0)|0))|0 != 0) // inlined GetBit
                    {
                        if (y > maxY) maxY = y;
                        if (y < minY) minY = y;
                        if (x > maxX) maxX = x;
                        if (x < minX) minX = x;
                    }//if
                }//for
            }//for
        }//if

        if (minX == 32767 && minY == 32767 && maxX == -32768 && maxY == -32768) 
        { 
            minX = 0; 
            minY = 0; 
            maxX = 256; 
            maxY = 256; 
        }//if

        var results = new Uint32Array(8);
        results[0] = minX;
        results[1] = minY;
        results[2] = maxX;
        results[3] = maxY;
        results[4] = z;
        results[5] = z;
        results[6] = x;
        results[7] = y;

        return results;
    };


    BITS.c_DecomposeIndexIntoIV = function(src_u16)
    {
        if (src_u16 == null)
        {
            return null;
        }//if
    
        var dest_i_str = "", dest_v_str = "";
        
        for (var i=0; i<4096; i=(i+1)|0)
        {
            if (src_u16[i] != 0) // inlined
            {
                dest_i_str += i < 0x0010 ? "000" + i.toString(16) 
                            : i < 0x0100 ?  "00" + i.toString(16) 
                            : i < 0x1000 ?   "0" + i.toString(16) 
                            :                      i.toString(16);
                            
                dest_v_str += src_u16[i] < 0x0010 ? "000" + src_u16[i].toString(16) 
                            : src_u16[i] < 0x0100 ?  "00" + src_u16[i].toString(16) 
                            : src_u16[i] < 0x1000 ?   "0" + src_u16[i].toString(16) 
                            :                               src_u16[i].toString(16);
            }//if
        }//for
        
        return [dest_i_str, dest_v_str];  
    };
    
    
    BITS.c_GetNewPlanar8FromBitmap = function(src_u16, data_u08, NODATA_u08)
    {
        var x,y,y_256,dest_u08 = new Uint8Array(65536);
        
        if (NODATA_u08 != 0) 
        { 
            for (var i=0; i<dest_u08.length; i++) 
            { 
                dest_u08[i] = NODATA_u08; // "memset"
            }//for 
        }//if
        
        for (y=0; y<256; y++)
        {
            y_256 = y << 8;
            
            for (x=0; x<256; x+=8) // loop unroll
            {
                if (BITS.c_GetBit(src_u16, x,   y)) dest_u08[(y_256)+x  ] = data_u08;
                if (BITS.c_GetBit(src_u16, x+1, y)) dest_u08[(y_256)+x+1] = data_u08;
                if (BITS.c_GetBit(src_u16, x+2, y)) dest_u08[(y_256)+x+2] = data_u08;
                if (BITS.c_GetBit(src_u16, x+3, y)) dest_u08[(y_256)+x+3] = data_u08;
                if (BITS.c_GetBit(src_u16, x+4, y)) dest_u08[(y_256)+x+4] = data_u08;
                if (BITS.c_GetBit(src_u16, x+5, y)) dest_u08[(y_256)+x+5] = data_u08;
                if (BITS.c_GetBit(src_u16, x+6, y)) dest_u08[(y_256)+x+6] = data_u08;
                if (BITS.c_GetBit(src_u16, x+7, y)) dest_u08[(y_256)+x+7] = data_u08;
            }//for
        }//for
    
        return dest_u08;
    };


//+(uint16_t)   Sets/replaces the instance's bitmap index with one newly synthesized from a RGBA8888 tile.
    BITS.GetBitmapFromRGBA8888Tile = function(src, unshadow, unstroke, ch_offset, alpha_threshold)
    {
        var dest = null;
    
        if (src != null)
        {
            dest = new Uint16Array(4096);

            if (unshadow) 
            {
                BITS.RecoverShadowAlphaInRGBA8888Tile(src, ch_offset, alpha_threshold);
            }//if
            
            if (unstroke)
            {
                var backup = new Uint8Array(src);
                BITS.RecoverDStrokeInRGBA8888Tile(src, backup, ch_offset, alpha_threshold);
                BITS.RecoverXStrokeInRGBA8888Tile(src, backup, ch_offset, alpha_threshold);
                BITS.RecoverYStrokeInRGBA8888Tile(src, backup, ch_offset, alpha_threshold);
                backup = null;
            }//if
            
            var x, bsX, bsY_64 = 0;
    
            for (var y = 0; y < 256; y = (y+4)|0)
            {
                bsX = 0;
                
                for (x = 0; x < 1024; x = (x+16)|0)
                {
                    dest[(bsY_64+bsX)|0] = BITS.GetBitmapCellFromPlanarTile_u16(src, x, y, ch_offset, 4, alpha_threshold);
                    bsX++;
                }//for
            
                bsY_64 = (bsY_64+64)|0;
            }//for
        }//if
        
        return dest;
    };


//+ (NSMutableArray*)   Returns most likely RGB indices for alpha index ch_offset.
    BITS.GetRGBAOffsetsForAlphaOffset = function(ch_offset)
    {
             if (ch_offset == 0) return [1,2,3,0];
        else if (ch_offset == 1) return [2,3,0,1];
        else if (ch_offset == 2) return [3,0,1,2];
        else                     return [0,1,2,3];
    };

//+ (void)  Sets the ch_offset (alpha) value to 0 when R, G and B pixels are all below alpha_threshold.
    BITS.RecoverShadowAlphaInRGBA8888Tile = function(src, ch_offset, alpha_threshold)
    {
        if (src != null)
        {
            var rgbac = BITS.GetRGBAOffsetsForAlphaOffset(ch_offset);
            var ac = ch_offset;
            var rc = rgbac[0];
            var gc = rgbac[1];
            var bc = rgbac[2];
            alpha_threshold = (alpha_threshold - 1)|0;

            var x, y_width, y_width_x;

            for (var y = 0; y < 256; y=(y+1)|0)
            {
                y_width = (y << 10)|0;
                
                for (x = 0; x < 1024; x=(x+4)|0)
                {
                    y_width_x = (y_width + x)|0;
                
                    if (src[(y_width_x + ac)|0]  > alpha_threshold
                     && src[(y_width_x + rc)|0] <= alpha_threshold
                     && src[(y_width_x + gc)|0] <= alpha_threshold
                     && src[(y_width_x + bc)|0] <= alpha_threshold)
                    {
                        src[(y_width_x + ac)|0] = 0;
                    }//if
                }//for
            }//for
        }//if
    };

//+ (void)  Partially recovers the alpha channel from a 2x2 NODATA fill.
    BITS.RecoverXStrokeInRGBA8888Tile = function(dest, src, ch_offset, alpha_threshold)
    {
        if (src != null)
        {
            var rgbac = BITS.GetRGBAOffsetsForAlphaOffset(ch_offset);
            var ac = ch_offset;
            var rc = rgbac[0];
            var gc = rgbac[1];
            var bc = rgbac[2];
            alpha_threshold = (alpha_threshold - 1)|0;
            var x, y_width, y_width_x;
            
            for (var y = 0; y < 256; y=(y+1)|0)
            {
                y_width = (y<<10)|0;
                
                for (x = 4; x < 1020; x=(x+4)|0)
                {
                    y_width_x = (y_width + x)|0;
                
                    if (   src[(  y_width_x         + ac)|0]  > alpha_threshold
                        && src[(((y_width_x - 4)|0) + ac)|0]  > alpha_threshold
                        && src[(((y_width_x + 4)|0) + ac)|0] <= alpha_threshold)
                    {
                          dest[(  y_width_x         + ac)|0] = 0;
                    }//if
                }//for
            }//for
        }//if
    };
    
//+ (void)  Partially recovers the alpha channel from a 2x2 NODATA fill.
    BITS.RecoverYStrokeInRGBA8888Tile = function(dest, src, ch_offset, alpha_threshold)
    {
        if (src != null)
        {
            var x;
            var rgbac = BITS.GetRGBAOffsetsForAlphaOffset(ch_offset);
            var ac = ch_offset;
            var rc = rgbac[0];
            var gc = rgbac[1];
            var bc = rgbac[2];
            alpha_threshold = (alpha_threshold - 1)|0;

            for (var y = 1; y < 255; y=(y+1)|0)
            {
                for (x = 0; x < 1024; x=(x+4)|0)
                {
                    if (   src[((((  (y      <<10)|0) + x)|0) + ac)|0] >  alpha_threshold
                        && src[(((((((y-1)|0)<<10)|0) + x)|0) + ac)|0] >  alpha_threshold
                        && src[(((((((y+1)|0)<<10)|0) + x)|0) + ac)|0] <= alpha_threshold)
                    {                        
                          dest[((((  (y      <<10)|0) + x)|0) + ac)|0] = 0;
                    }//if
                }//for
            }//for
        }//if
    };
    
//+ (void)  Partially recovers the alpha channel from a 2x2 NODATA fill.
    BITS.RecoverDStrokeInRGBA8888Tile = function(dest, src, ch_offset, alpha_threshold)
    {
        if (src != null)
        {
            var x;
            var rgbac = BITS.GetRGBAOffsetsForAlphaOffset(ch_offset);
            var ac = ch_offset;
            var rc = rgbac[0];
            var gc = rgbac[1];
            var bc = rgbac[2];
            alpha_threshold = (alpha_threshold - 1)|0;

            for (var y = 1; y < 255; y=(y+1)|0)
            {
                for (x = 4; x < 1020; x=(x+4)|0)
                {
                    if (   src[((((  (y      <<10)|0) +   x  )|0)     + ac)|0] >  alpha_threshold
                        && src[(((((((y-1)|0)<<10)|0) + ((x-4)|0))|0) + ac)|0] >  alpha_threshold
                        && src[(((((((y+1)|0)<<10)|0) + ((x+4)|0))|0) + ac)|0] <= alpha_threshold)
                    {                        
                          dest[((((  (y      <<10)|0) +   x  )|0)     + ac)|0]  = 0;
                    }//if
                }//for
            }//for
        }//if
    };









    // returns uint16_t scalar value of cell, intened to then be set in the uint16_t* bitmap index vector.
    // this is synthesized from 4x4 cells (16 total) from the 256x256 source tile src.
    
//+ (uint16_t)
    BITS.GetBitmapCellFromPlanarTile_u16 = function(src, x, y, offset, stride, threshold)
    {
        var bitX,bitY_256,idxCount=0,cellValue=0;
        threshold = (threshold - 1)|0;
    
        for (var bitY = y; bitY < (y + 4)|0; bitY=(bitY+1)|0)
        {
            bitY_256 = (((bitY * 256)|0) * stride)|0;
        
            for (bitX = x; bitX < (x + (4 * stride)|0)|0; bitX=(bitX+stride)|0)
            {
                if (src[((bitY_256 + bitX)|0 + offset)|0] > threshold)
                {
                    cellValue = (cellValue | ((1 << idxCount)|0))|0;
                }//if
            
                idxCount = (idxCount + 1)|0;
            }//for
        }//for
    
        return cellValue;
    };
    

//+ (void*)     Primary coordinate system reprojection function, for EPSG3857 pixel or tile x/y at different zoom levels.
    BITS.c_MercXZtoMercXZ = function(x, z, dest_z)
    {
        return dest_z > z ? (x << ((dest_z - z)|0))|0 : (x >>> ((z - dest_z)|0))|0;
    };
    
    
//+ (void)  Variant of above, for uint32_t extent vector.  Reprojects both 4 vertices from z=v[5] to z=v[6]
    BITS.c_vMercXYZtoMercXYZ_u32 = function(v)
    {
        // v[0] = BITS.c_MercXZtoMercXZ(v[0], v[5], v[4]); // <-- doesn't always work, FP magnitude errors outside array for z=23
        if (v[4] > v[5])
        {
            v[0] = (v[0] << (v[4] - v[5])|0)|0;
            v[1] = (v[1] << (v[4] - v[5])|0)|0;
            v[2] = (v[2] << (v[4] - v[5])|0)|0;
            v[3] = (v[3] << (v[4] - v[5])|0)|0;
        }//if
        else
        {
            v[0] = (v[0] >>> (v[5] - v[4])|0)|0;
            v[1] = (v[1] >>> (v[5] - v[4])|0)|0;
            v[2] = (v[2] >>> (v[5] - v[4])|0)|0;
            v[3] = (v[3] >>> (v[5] - v[4])|0)|0;
        }//else
    };
    

    
//+ (uint32_t*)     New wrapper for c_SetPxExtentVector_u32.
    BITS.c_GetNewPxExtentVector_u32 = function(x, y, z, dest_z)
    {
        var v = new Uint32Array(6);
        BITS.c_SetPxExtentVector_u32(v, x, y, z, dest_z);
        return v;
    };
    
    
//+ (void)      Fills rectangular coordinates @ dest_z represented by input tile x,y @ z.  Use with Uint32Array.
    BITS.c_SetPxExtentVector_u32 = function(v, x, y, z, dest_z)
    {
        v[0] = (x << 8)|0;
        v[1] = (y << 8)|0;
        v[4] = dest_z;
        v[5] = z;
    
        v[2] = 256;                                                  // width
        v[2] = (BITS.c_MercXZtoMercXZ(v[2], v[5], v[4]) - 1)|0;      // -1 for 0-based index
        v[3] = v[2];                                                 // copy to height, same
    
        v[0] = BITS.c_MercXZtoMercXZ(v[0], v[5], v[4]);              // reproject origin x/y
        v[1] = BITS.c_MercXZtoMercXZ(v[1], v[5], v[4]);
    
        v[2] = (v[2] + v[0])|0;                                      // reproject end point x/y, width  - x0
        v[3] = (v[3] + v[1])|0;                                      //                          height - y0
    };
    
    
    
    
//+ (void)  Proprietary, for use with GetPixelExtentFromBitstore.  Converts its output to a map extent vector, in place.
    BITS.c_vPixelExtentToMercExtent_u32 = function(v)
    {
        if (v == null || v.length < 7)
        {
            if (this._log) console.log("BITS.c_vPixelExtentToMercExtent_u32: Nein.");
            return;
        }//if
    
        //          px      v       // pixel and merc extent vectors are slightly different
        //          --      --      // but the merc functions will never look at element 6, so
        // [0]      x0      x0      // it's safe to reuse the old pixel buffer when doing a
        // [1]      y0      y0      // conversion
        // [2]      x1      x1
        // [3]      y1      y1
        //
        // [4]      z       z
        // [5]      z       src_z
        // [6]      x
        // [7]      y
        
        var dest_z = BITS.c_GetDefaultExtentZoomLevel(); // new zoom level for extent
        
        v[0] += v[6] << 8;  // offset by tile x/y in pixels at original zoom level
        v[1] += v[7] << 8;
        v[2] += v[6] << 8;
        v[3] += v[7] << 8;
        
        v[4]  = dest_z;     // set the destination zoom level for the reprojection
        
        BITS.c_vMercXYZtoMercXYZ_u32(v); // reproject
    };

//+ (void)  Constant with a k.  If you set this lower than max zoom level of the map, you're not gonna have a good time.    
    BITS.c_GetDefaultExtentZoomLevel = function()
    {
        return 23;
    };
    
    

    
    
    
    
    return BITS;
})();
