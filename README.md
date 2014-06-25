bitstore.js
===========
 
A general bitmap indexing solution for improving tile web map performance.


##What it Does
 1. Indexes raster tile sets used by web maps.
 2. Uses alpha channel of tiles themselves to reduce maintenance requirements.
 3. Improves performance by not requesting tiles that do not exist.

##Can this make my map faster?
Possibly.

Do you have a raster tile layer with holes in it?  Or is it clipped to a shoreline?  Are your tiles PNGs with an alpha channel?

Then yes, it probably can.
 
##Is there a demo?
Yes, as of 2014-06-24.  See http://safecast.org/tilemap

In particular, right click on the map and select "Bitmap Index Visualization" or "Show All Bitmap Indices", which renders all the bitmap indices created by this library for a production application. (via the futuristic wonders of client-side uncompressed GIF89A)

##What about server performance?
It can reduce server load.

Consider a map showing a shoreline; suppose your tiles are only over the land.  If you prevent loads from the non-existent tiles over the water, the server just received half the normal HTTP requests.

Less load, less bandwidth.  Client serve YOU.

##What happens if you don't block the load attempt?
You don't get in b4 404.

The request goes to the server, and the server replies 404 NOT FOUND (or maybe serves a blank tile if it's smart).
If the server replied with 404, here's the problem: the next time you pan the map back over that area, it will request the 404 tile again.

The map API does not have memory of this.

##Indexing sounds like a lot of work!
For me, yes.  For you, not much work at all.  The client code does all the work.  Just point this at a single tile, and you can plug it in using two lines of code.

##What about mobile devices?
It helps them the most of all.  Each uncompressed PNG tile is 256KB of RAM.  (+overhead)  Each bitmap index is 8KB; so an index that prevents a single tile load pays its upkeep.  The processing time of querying the indices is minimal.  In short: less data transfer, less memory use, less processing required.

##But how does it do that?
By doing nothing at all.  As it turns out, you can do nothing pretty quickly.

##What happens if I update my dataset?
It will detect this via the server's Last-Modified datetime in an intial HTTP get header request.  You can also specify a callback function to use this date in your UI.

##Where did this come from?
This is a spin-off from development efforts in mapping the Safecast dataset (safecast.org), of volunteer-collected measurements of radiation data.

Bitmap indexing was first implemented in C on iOS as a result of code profiling showing the tremendous amount of time spent trying to load data that wasn't there.

This proved a significant improvement, and contributed to the glory of a native C SIMD code chain along with backup from the Accelerate framework and GCD tearing raster data apart, like conquering god-kings of myth.

Later, with further development of a web map, it became appearent the same bitmap indexing techniques could be used to improve performance on the intarwebz.  (One expects web maps would automatically use quadtrees, but this isn't so.)  Unfortunately, directly exporting the C data structures proved inflexible, and the same data was not present to recreate them.

It quickly became problematic to attempt to include new datasets, or deal with changes outside of the original native code environment.

This library was created as a solution to all of that.

bitstores.js provides the same performance benefits, but has been reworked to be much more versatile so it should work with most tilesets.  It is also adaptive should they change, without the need for manual intervention.

#Is there anything else like it?
Yes, but not for the web.  Raster GIS data has been getting indexed in some form since the 1970s, so there's plenty.  In terms of web maps though, there is nothing else I am aware of.

Apple's MapKit framework for iOS and OS X implements quadtrees which are created dynamically and index raster tiles as they are loaded.  ESRI's ArcGIS Online has JavaScript-based client quadtree indexing of geometry features, though not rasters.

##How many indices should I use?
It depends on your data.  For some datasets, even a single index tile can be very significant.

Each index tile can be used for an additional 8 zoom levels before false positives begin to occur, which are not fatal.  The rate it degrades past 8 zoom levels depends on the dataset.

Realistically, you probably don't want to make the client download more than a couple MB of tiles to index.  But the indices are cached, so if you have a consistent userbase, you can be more aggressive as the indices will only be created once.

##How should I use the lazy loading modes?
As not lazily as possible.  I prefer to stick the loading costs up front.  With multithreading enabled, web workers will oversubscribe concurrent HTTP connections whichis a very efficient way to maximize data transfer efficiency.
Users don't tend to immediately pan the map, so you get at least a couple seconds of this.

The full lazy load model doesn't work with multithreading, blocks on the main thread, suffers from cache misses until the async HTTP GETs go through, and in general makes using the map less pleasant.

Conversely, if the map has multiple layers, it is probably best not to load all of them immediately, especially if not all layers will be used at once.  Here, the alternate lazy load mode ("dim"*) is useful, as with the initial map load, you also get a few seconds when layers are changed where loads are not perceptible.

(*yes, I enjoy naming option flags after Randall Flagg)

##Is HTML5 Canvas mode really that bad?
It is significantly slower, by a factor of anywhere from about 2x to 20x.  It also will not run in a background thread.  The reason Canvas support is included nonetheless is so that this code does not absolutely require any further JS libraries.  Canvas also has advantages in that it will interop with other formats of images and is likely more robust.

##Is it "indexes" or "indices"?

Indexes is a verb.  Indices is a noun.

##Who wrote this?  Can I reuse it?
This library was written by Nick Dolezal on behalf of safecast.org and the Momoko Ito Foundation, and is released into the public domain.

##Requirements
Data:
  - 1. 256x256 Web Mercator PNG tiles with alpha channel that correlates with tiles intentionally not present
  - 2. Google Maps tile X/Y/Z convention.
  - 3. A single tile that shows the entire dataset at once.  (guaranteed to be the zoom level 0 tile)

Script Dependencies:
  - 1. png.js / zlib.js -- entirely optional, but recommended.  Significantly improves performance over HTML5 Canvas.


(png.js / zlib.js source: http:github.com/devongovett/png.js/ )


##Stuff it will probably work on:
 - survey measurements collected by a ground vehicle or aircraft
 - an interpolation of average temperatures over land, clipped so as not to extend over water

##Stuff it probably won't work on:
 - a basemap spanning the entire globe
 - JPEGs or PNGs without an alpha channel*

(*It is likely that HTML5 Canvas mode can be used for JPEGs, RGBX PNGs, etc as Canvas always returns RGBA8888 data.  However, this is untested.)



##Components
Single file solution.  100% pure vanilla standards-compliant JavaScript.

1. bitstore.js:
  - Class: LBITS - Layer Bitstore (holds 1...n BITS)
  - Class: BITS  - Bitstore
  - Class: LBITSOptions - for specfying extra stuff manually to LBITS



##Example

1. Instantiate with constructor at startup:
===

##Basic Configuration:

    MY_FIRST_BARBIE_GLOBAL_POINTER = new LBITS(2, 0, 16, "http://safecast.org/tilemap/tiles/{z}/tile_{z}_{x}_{y}.png", 0, 0, null, null);


##Custom Configuration, with options and date callback:

    var opts = new LBITSOptions({ idx_max_bitmap_z:5 });
    var dateCallback = function(dateString) 
    {
        document.getElementById("0").innerText += " " + dateString;
    };
    MY_FIRST_BARBIE_GLOBAL_POINTER = new LBITS(2, 0, 16, "http://safecast.org/tilemap/tiles/{z}/tile_{z}_{x}_{y}.png",  0, 0, opts, dateCallback);


2. Add "ShouldLoadTile" to Google Maps API tile callback.
===


     getTileUrl: function (xy, z)
                 {
                    var nXY = getNormalizedCoord(xy, z);
                    if (    !nXY
                        || (!MY_FIRST_BARBIE_GLOBAL_POINTER.ShouldLoadTile(2, nXY.x, nXY.y, z)))
                    {
                        return null;
                    }//if
                    return "http://safecast.org/tilemap/tiles/" + z + "/tile_" + z + "_" + nXY.x + "_" + nXY.y+ ".png"
                  }


(note: getNormalizedCoord can be found here: http://developers.google.com/maps/documentation/javascript/maptypes )


##Maintenance Requirements
One of the design goals for bitstores.js was to reduce maintenance requirements; hence the last-modified date callback, and the auto-updated extent, etc.  It is less metadata to manually maintain.  This even works in a dumb server environment.

Nonetheless, the min/max Z and master tile x/y must all be updated if the dataset significantly changes.
It is recommended the master tile be set to the zoom level 0 tile to be future-proof for updatable datasets whose extents may change.

##Failure Modes and Uncertainty
All the failure modes of bitstores are designed to be false positives; that is, the data will load as it would have anyway.

If the master index tile for a layer does not load, it simply always returns true.
If any index after that fails to load, the lower-resolution data from the master index will be used instead.  Lower resolution data has one failure mode: again, false positive.

This also means that the data need not be perfectly indexed for bitstores to be effective.  Even the base master tile alone can be very effective, and all that is needed for some datasets.

##Verifying Operation
To verify everything is working normally, there should be a rather obvious performance improvement when panning the map
 near a coastline, assuming your rasters are clipped to it and there are none in the ocean.
 
A less subjective way is probably taking a heap snapshot in a web browser's dev tools, and walking the LBITS -> BITS object heirarchy.

But, if you wanted a more visual reprsentation, there is a function included for that:

                    BITS.prototype.GetNewPlanar8FromBitmap = function(data_u08, NODATA_u08)
                    
This returns a new UInt8Array with 64k elements (a 256x256 image), which can be converted into an image via HTML5 Canvas's putImageData or similar (lib_bmp.js, etc).



##Optional Components
Optional support for faster processing and multithreading requires libpng and zlib.

  - 1. png.js
    - Comment: Not necessary, but will use slower HTML5 Canvas fallback if not present.
    - Comment: Strongly recommended for best results.

*OR*

  - 1. png_worker.js
    - Comment: This is a version of png.js modified to work with background Web Worker threads.
    - Comment: This allows for both better performance as with the vanilla png.js, and also multithreading.
  - 2. zlib.js
    - Comment: Necessary for either png.js.
    - Comment: No need for any particular version of this.

png.js and zlib.js source:  http:github.com/devongovett/png.js/

eg: in the production version at safecast.org, I have:
  - 1. png_zlib_worker_min.js -- modded for the multithreading worker
  - 2. png_zlib_min.js        -- regular vanilla library, used for other things
  - 3. bitstore_min.js        -- used for the core functionality and the multithreading worker as well

##Optional Configuration - Multithreading
Multithreading support is optional, and available via an inlined Web Worker.  As with all web workers, overall throughput is reduced in exchange for less main thread / UI blocking.

Multithreading may not clearly be worth the headache of configuring it in all cases; you do not need to use it.

Multithreading is not compatible with HTML 5 Canvas.  HTML 5 Canvas will only run on the main thread.

Multithreading will not work if full lazy load mode is enabled; the overhead of serializing copies is too high.

Multithreading support requires three include files which can be specified in the LBITSOptions object.

When specifying the URL for these, note it must be absolute for an inlined worker.

Using a minified or combined version is fine; however, the correct URL must be specified.

  - 1. bitstores.js (this)
  - 2. png_worker.js
  - 3. zlib.js

##Modding png.js for the Multithreaded Background Worker
Replace the original lines with the following:

     Line         New Code                      Comment
    ------------ --------------------------    ------------------------------------------------------------------------
     - Line 25:   (function() {                Disable the outer function wrapper, kill the "window" dependancy.
     - Line 26:     var PNG;                   Disable the outer function wrapper, kill the "window" dependancy.
     - Line 28:   var PNG = (function() {      Rework the inner function wrapper to be stand-alone.
     - Line 361:  scratchCanvas = null;        Disable all explicit Canvas refs on init, kill the "document" dependancy.
     - Line 362:  scratchCtx = null;           Disable all explicit Canvas refs on init, kill the "document" dependancy.
     - Line 457:  window.PNG = PNG;            Disable the outer function wrapper, kill the "window" dependancy.
     - Line 459:  }).call(this);               Disable the outer function wrapper, kill the "window" dependancy.

This will remove the references to document and window, which are verboten in a background web worker.  However, it will also break all the functionality in png.js that uses those features, so it is recommended to keep the original.





##Optional Configuration - Image Processing
In some cases, the raster's alpha channel may not perfectly correspond with the tiles present because the raster had post-processing effects added to improve visibility.

Two optional processing modes are available to help recover alpha channel data.  While imperfect, they can significantly improve results by improving the precision of the index.

  - 1. "Shadow" - Pure black / near pure-black RGB values
    - requires that the RGB values be below the alpha threshold
    - if so, the alpha channel value is zeroed, recovering the index data
    - success rate: 100%
  - 2. "Stroke" - 2x2 NODATA fill
    - most NODATA fills are symmetric neighborhood functions (eg 3x3). This does not work with those.
    - this only works with an asymmetric 2x2 fill, and only one that is forward only.
    - success rate: ~80%

##Stroke Recovery
(not that kind)

The particulars of the three-pass algorithm are depicted below to help provide understanding if it will be compatible with your dataset or not.

For a 2x2 NODATA fill stroke which only moves +,+ when there is data, the following is seen:

         Original              Stroke
     +--+--+--+--+--+     +--+--+--+--+--+
     |  |  |  |  |  |     |  |  |  |  |  |
     +--+--+--+--+--+     +--+--+--+--+--+
     |  |AA|  |  |  |     |  |AA|FF|  |  |
     +--+--+--+--+--+     +--+--+--+--+--+
     |  |  |  |  |  |     |  |FF|FF|  |  |
     +--+--+--+--+--+     +--+--+--+--+--+
     |  |  |  |  |  |     |  |  |  |  |  |
     +--+--+--+--+--+     +--+--+--+--+--+


To remove this per the above example, the following can be performed:

         Stroke              D Recovery           Y Recovery           X Recovery
     +--+--+--+--+--+     +--+--+--+--+--+     +--+--+--+--+--+     +--+--+--+--+--+
     |  |  |  |  |  |     |  |  |  |  |  |     |  |  |  |  |  |     |  |  |  |  |  |
     +--+--+--+--+--+     +--+--+--+--+--+     +--+--+--+--+--+     +--+--+--+--+--+
     |  |AA|FF|  |  |     |  |AA|FF|  |  |     |  |AA|FF|  |  |     |  |AA|  |  |  |
     +--+--+--+--+--+     +--+--+--+--+--+     +--+--+--+--+--+     +--+--+--+--+--+
     |  |FF|FF|  |  |     |  |FF|  |  |  |     |  |  |  |  |  |     |  |  |  |  |  |
     +--+--+--+--+--+     +--+--+--+--+--+     +--+--+--+--+--+     +--+--+--+--+--+
     |  |  |  |  |  |     |  |  |  |  |  |     |  |  |  |  |  |     |  |  |  |  |  |
     +--+--+--+--+--+     +--+--+--+--+--+     +--+--+--+--+--+     +--+--+--+--+--+


However, this can also fail.  What if the original area had been different?  (assume the edges extend right and down)

         Stroke              D Recovery           Y Recovery           X Recovery
     +--+--+--+--+--+     +--+--+--+--+--+     +--+--+--+--+--+     +--+--+--+--+--+
     |  |AA|FF|  |  |     |  |AA|FF|  |  |     |  |AA|FF|  |  |     |  |AA|  |  |  |
     +--+--+--+--+--+     +--+--+--+--+--+     +--+--+--+--+--+     +--+--+--+--+--+
     |AA|FF|AA|AA|FF|     |AA|FF|AA|AA|FF|     |AA|FF|AA|AA|FF|     |AA|FF|AA|AA|  |
     +--+--+--+--+--+     +--+--+--+--+--+     +--+--+--+--+--+     +--+--+--+--+--+
     |AA|AA|AA|AA|FF|     |AA|AA|AA|AA|  |     |AA|AA|AA|AA|  |     |AA|AA|AA|AA|  |
     +--+--+--+--+--+     +--+--+--+--+--+     +--+--+--+--+--+     +--+--+--+--+--+
     |FF|FF|FF|FF|FF|     |FF|  |  |AA|  |     |  |  |  |AA|  |     |  |  |  |AA|  |
     +--+--+--+--+--+     +--+--+--+--+--+     +--+--+--+--+--+     +--+--+--+--+--+

Unfortunately, it cannot recover cells that were originally adjacent to other data cells both right and down.  And they cannot be discriminated by value or alpha.

A possibility that remains is getting the z+1 tiles instead, and downsampling them by 2x.

##LBITS -- Layer Bitstore
The Layer Bitstore (LBITS) "class" is a convienience wrapper that automates indexing a layer.

This is really the only componenet you should need to use. (other than maybe the options container)

As mentioned above, once set up with a couple numbers and a URL, it is fully automated, self-updating, and client-side.
It only needs to know a few things:

  - 1. The min and max zoom levels of your layer
  - 2. A URL template to use, substituting {z} {x} and {y} for numbers.
  - 3. The x/y/z for a single RGBA8888 PNG tile that indexes the entire dataset.  This is guaranteed to be the z=0 tile for every dataset.
  - 4. An arbitrary unique integer "layerId" to link the index to a particular tileset comprising a layer.  This can be any integer value, but should be unique.  If you have very similar layers, you can reuse the layerId from one as a proxy in another.

When passed this information in the LBITS constructor, the code will:

  - 1. Load the PNG (or from cache, if present)
  - 2. Create an initial "master" global bitmap index from the alpha channel
  - 3. Calculate the layer's extent
  - 4. Determine what other indices are needed.
    - a. Find a single tile to do this, if possible.
    - b. If not, decompose and reproject the global index into a list of many additional tiles.
  - 5. Create bitstores for 0 - n additional tiles found in #3
