bitstore.js
===========
 
A general bitmap indexing solution for improving tile web map performance.


####What it Does
 1. Indexes raster tile sets used by web maps.
 2. Uses alpha channel of tiles themselves to reduce maintenance requirements.
 3. Improves performance by not requesting tiles that do not exist.

####Sample PNG to Bitmap Index

PNG  | Bitmap Index
---- | ----
![56,24@6png](https://github.com/Safecast/bitstore.js/raw/master/images/TileExport_6_56_24.png) | ![56,24@6gif](https://github.com/Safecast/bitstore.js/raw/master/images/TileExport_6_56_24.gif)


####Can this make my map faster?
Possibly.

Do you have a raster tile layer with holes in it?  Or is it clipped to a shoreline?  Are your tiles PNGs with an alpha channel?

Then yes, it probably can.
 
####Is there a demo?
Yes, as of 2014-07-01.  See http://safecast.org/tilemap (source code: https://github.com/Safecast/Tilemap)

In particular, right click on the map and select "Bitmap Index Visualization" or "Show All Bitmap Indices", which renders all the bitmap indices created by this library for a production application. (via the futuristic wonders of client-side uncompressed GIF89A)

####What about server performance?
It can reduce server load.

Consider a map showing a shoreline; suppose your tiles are only over the land.  If you prevent loads from the non-existent tiles over the water, the server just received half the normal HTTP requests.

Less load, less bandwidth.  Client serve YOU.

####What happens if you don't block the load attempt?
You don't get in b4 404.

The request goes to the server, and the server replies 404 NOT FOUND (or maybe serves a blank tile if it's smart).
If the server replied with 404, here's the problem: the next time you pan the map back over that area, it will request the 404 tile again.

The map API does not have memory of this.

####Indexing sounds like a lot of work!
For me, yes.  For you, not much work at all.  The client code does all the work.  Just point this at a single tile, and you can plug it in using two lines of code.

####What about mobile devices?
It helps them the most of all.  Each uncompressed PNG tile is 256KB of RAM.  (+overhead)  Each bitmap index is 8KB; so an index that prevents a single tile load pays its upkeep.  The processing time of querying the indices is minimal.  In short: less data transfer, less memory use, less processing required.

####But how does it do that?
By doing nothing at all.  As it turns out, you can do nothing pretty quickly.

####What happens if I update my dataset?
It will detect this via the server's Last-Modified datetime in an intial HTTP get header request.  You can also specify a callback function to use this date in your UI.

####Where did this come from?
This is a spin-off from development efforts in mapping the Safecast dataset (http://safecast.org), of volunteer-collected measurements of radiation data.

Bitmap indexing was first implemented in C on iOS as a result of code profiling showing the tremendous amount of time spent trying to load data that wasn't there.

This proved a significant improvement, and contributed to the glory of a native C SIMD code chain along with backup from the Accelerate framework and GCD tearing raster data apart, like conquering god-kings of myth.

Later, with further development of a web map, it became appearent the same bitmap indexing techniques could be used to improve performance on the intarwebz.  (One expects web maps would automatically use quadtrees, but this isn't so.)  Unfortunately, directly exporting the C data structures proved inflexible, and the same data was not present to recreate them.

It quickly became problematic to attempt to include new datasets, or deal with changes outside of the original native code environment.

This library was created as a solution to all of that.

bitstore.js provides the same performance benefits, but has been reworked to be much more versatile so it should work with most tilesets.  It is also adaptive should they change, without the need for manual intervention.

####Is there anything else like it?
Yes, but not for the web.  Raster GIS data has been getting indexed in some form since the 1970s, so there's plenty.  In terms of web maps though, there is nothing else I am aware of.

Apple's MapKit framework for iOS and OS X implements quadtrees which are created dynamically and index raster tiles as they are loaded.  ESRI's ArcGIS Online has JavaScript-based client quadtree indexing of geometry features, though not rasters.

####How many indices should I use?
It depends on your data.  For some datasets, even a single index tile can be very significant.

Each index tile can be used for an additional 8 zoom levels before false positives begin to occur, which are not fatal.  The rate it degrades past 8 zoom levels depends on the dataset.

Realistically, you probably don't want to make the client download more than a couple MB of tiles to index.  But the indices are cached, so if you have a consistent userbase, you can be more aggressive as the indices will only be created once.

####How should I use the lazy loading modes?
As not lazily as possible.  I prefer to stick the loading costs up front.  With multithreading enabled, web workers will oversubscribe concurrent HTTP connections which is a very efficient way to maximize data transfer efficiency.
Users don't tend to immediately pan the map, so you get at least a couple seconds of this.

The full lazy load model doesn't work with multithreading, blocks on the main thread, suffers from cache misses until the async HTTP GETs go through, and in general makes using the map less pleasant.

Conversely, if the map has multiple layers, it is probably best not to load all of them immediately, especially if not all layers will be used at once.  Here, the alternate lazy load mode ("dim"*) is useful, as with the initial map load, you also get a few seconds when layers are changed where loads are not perceptible.

(*yes, I enjoy naming option flags after Randall Flagg)

####Is HTML5 Canvas mode really that bad?
It is significantly slower, by a factor of anywhere from about 2x to 20x.  It also will not run in a background thread.  The reason Canvas support is included nonetheless is so that this code does not absolutely require any further JS libraries.  Canvas also has advantages in that it will interop with other formats of images and is likely more robust.

####Is it "indexes" or "indices"?

Indexes is a verb.  Indices is a noun.

####Who wrote this?  Can I reuse it?
This library was written by Nick Dolezal on behalf of safecast.org and the Momoko Ito Foundation, and is released into the public domain.

####Requirements
Data:
  - 1. 256x256 Web Mercator PNG tiles with alpha channel that correlates with tiles intentionally not present*
  - 2. Google Maps tile X/Y/Z convention.
  - 3. A single tile that shows the entire dataset at once.  (guaranteed to be the zoom level 0 tile)

Script Dependencies:
  - 1. png.js / zlib.js** -- entirely optional, but recommended.  Significantly improves performance over HTML5 Canvas.


(* this has been verified to work with indexed color PNGs, not just RGBA, and is also assumed to work with the single transparent color RGB mode.  It will technically work on RGB PNGs, but it may not be possible to build a mask from RGB data based purely on the channel-threshold model.)

(** png.js / zlib.js source: http://github.com/devongovett/png.js/ ... now included in the "Optional" directory in this repo.)


####Stuff it will probably work on:
 - survey measurements collected by a ground vehicle or aircraft
 - an interpolation of average temperatures over land, clipped so as not to extend over water

####Stuff it probably won't work on:
 - a basemap spanning the entire globe
 - JPEGs or PNGs without an alpha channel*

(*It is likely that HTML5 Canvas mode can be used for JPEGs, GIFs, etc as Canvas always returns RGBA8888 data.  However, this is untested.)



####Components
Single file solution.  100% pure vanilla standards-compliant JavaScript.

1. bitstore.js:
  - Class: LBITS - Layer Bitstore (holds 1...n BITS)
  - Class: BITS  - Bitstore
  - Class: LBITSOptions - for specfying extra stuff manually to LBITS



####Other Things That Support bitstore.js
1. Retile
  - http://github.com/Safecast/Retile
  - Retile is sort of like gdal2tiles, only it takes a directory of tiles as the input.
  - All processing modes guarantee that the alpha channel is preserved 100% for bitstore.js, even when using Lanczos.


##Implementation Example

#####1. Globals

```
importScripts("bitstore.js");
var MY_FIRST_BARBIE_GLOBAL_POINTER = null;
```

#####2. Instantiate with constructor at startup:

It puts the code in the init function or it gets the bucket again.

######Basic Configuration:

```
MY_FIRST_BARBIE_GLOBAL_POINTER = new LBITS(2, 0, 16, "http://s.org/tiles/{z}/tile_{z}_{x}_{y}.png", 0, 0, null, null);
```

######Custom Configuration, with options and date callback:

```
var opts = new LBITSOptions({ idx_max_bitmap_z:5 });
var dateCallback = function(dateString) 
{
    document.getElementById("0").innerText += " " + dateString;
};
MY_FIRST_BARBIE_GLOBAL_POINTER = new LBITS(2, 0, 16, "http://s.org/tiles/{z}/tile_{z}_{x}_{y}.png",  0, 0, opts, dateCallback);
```

#####3. Add "ShouldLoadTile" to Google Maps API tile callback.

```
getTileUrl: function (xy, z)
            {
                var nXY = getNormalizedCoord(xy, z);
                if (    !nXY
                    || (!MY_FIRST_BARBIE_GLOBAL_POINTER.ShouldLoadTile(2, nXY.x, nXY.y, z, null)))
                {
                    return null;
                }//if
                return "http://s.org/tiles/" + z + "/tile_" + z + "_" + nXY.x + "_" + nXY.y+ ".png"
            }
```

(note: getNormalizedCoord can be found here: http://developers.google.com/maps/documentation/javascript/maptypes ... this is optional, but if you send extent checks which are out of the bounds of the coordinate system, it will always return false, which is the expected behavior.)




Operational Example
===========

###### Constructor

```
var _lb8 = new LBITS(8, 2, 13, "http://.../{z}/griddata_{x}_{y}_{z}.png", 3, 1, NULL, NULL);
```

###### One Dataset. One Tile. One Index.

It all starts with loading a single tile, and using its alpha channel.  Bitstore.js is to alpha channels as zombies are to brainnnnssss.

So, from the constructor parameters, load the user-specified master tile (3, 1), for the minimum zoom level of 2.

PNG  | Bitmap Index
---- | ----
![3,1@2png](https://github.com/Safecast/bitstore.js/raw/master/images/griddata_3_1_2.png) | ![3,1@2gif](https://github.com/Safecast/bitstore.js/raw/master/images/griddata_3_1_2.gif)

This provides 100% precise information about what tiles to load up to zoom level (index_z + 8), or zoom level 10.  bitstore.js is operational at this point.

###### Determine Additional Tiles To Load

The master index tile provided coverage up to zoom level 10.  That's functional, but it could be better.

For a max zoom level of 13, at least zoom level 5 is required for full coverage. (1 pixel @ z=5 == 1 tile @ z=13)

Therefore: decompose the (3,1) @ z=2 bitmap index to pixel x/y coordinates.  Offset for tile origin.  Convert to distinct tile x/y.  Results:

```
28, 11
28, 12
27, 12
27, 13
```

###### Get Detail Tiles, Convert to Bitmap

As with the master tile, the detail tiles are loaded asynchronously, and added to the BITS collection Array.  Once they are added, they are used automatically to provide higher-precision information about what tiles should be loaded in their extent.

PNG  | Bitmap Index
---- | ----
![28,11@5png](https://github.com/Safecast/bitstore.js/raw/master/images/griddata_28_11_5.png) | ![28,11@5gif](https://github.com/Safecast/bitstore.js/raw/master/images/griddata_28_11_5.gif)
![28,12@5png](https://github.com/Safecast/bitstore.js/raw/master/images/griddata_28_12_5.png) | ![28,12@5gif](https://github.com/Safecast/bitstore.js/raw/master/images/griddata_28_12_5.gif)
![27,12@5png](https://github.com/Safecast/bitstore.js/raw/master/images/griddata_27_12_5.png) | ![27,12@5gif](https://github.com/Safecast/bitstore.js/raw/master/images/griddata_27_12_5.gif)
![27,13@5png](https://github.com/Safecast/bitstore.js/raw/master/images/griddata_27_13_5.png) | ![27,13@5gif](https://github.com/Safecast/bitstore.js/raw/master/images/griddata_27_13_5.gif)

###### Done

Now, when there are requests for tiles, the extent of the tile can be checked vs. the bitmap index without error.

Only if the tile's extent intersects data is the request allowed to proceed.


##FAQ (con't)

####What's with the "extent_u32" parameter in LBITS.ShouldLoadTile?  Do I need that?

No.  It's completely optional and a mechanism for preventing allocations if you're particularly hardcore and like buffer pools.  It will be created automatically internally from the x/y/z parameters.  Just pass null as shown above and all will be well.

####What's the layerId parameter?

An arbitrary integer that uniquely identifies that layer / tileset.  ("2" in the above example)  Set it as you like.

##Misc Info

####Maintenance Requirements
One of the design goals for bitstore.js was to reduce maintenance requirements; hence the last-modified date callback, and the auto-updated extent, etc.  It is less metadata to manually maintain.  This even works in a dumb server environment.

Nonetheless, the min/max Z and master tile x/y must all be updated if the dataset significantly changes.
It is recommended the master tile be set to the zoom level 0 tile to be future-proof for updatable datasets whose extents may change.

####Failure Modes and Uncertainty
All the failure modes of bitstores are designed to be false positives; that is, the data will load as it would have anyway.

If the master index tile for a layer does not load, it simply always returns true.
If any index after that fails to load, the lower-resolution data from the master index will be used instead.  Lower resolution data has one failure mode: again, false positive.

This also means that the data need not be perfectly indexed for bitstores to be effective.  Even the base master tile alone can be very effective, and all that is needed for some datasets.

####Verifying Operation
To verify everything is working normally, there should be a rather obvious performance improvement when panning the map
 near a coastline, assuming your rasters are clipped to it and there are none in the ocean.
 
A less subjective way is probably taking a heap snapshot in a web browser's dev tools, and walking the LBITS -> BITS object heirarchy.

But, if you wanted a more visual reprsentation, there is a function included for that:

```
BITS.prototype.GetNewPlanar8FromBitmap = function(data_u08, NODATA_u08)
```
                 
This returns a new UInt8Array with 64k elements (a 256x256 image), which can be converted into an image via HTML5 Canvas's putImageData or similar (lib_bmp.js, etc).

Another approach to just test the net effect it has is to embed a global counter variable in getTileUrl and track how many loads it prevented.  Or, instead of returning null upon false from getTileUrl, one could return a URL to an obviously static 256x256 image (eg http://safecast.org/tilemap/dogetile2.png ).



####Optional Components
Optional support for faster processing and multithreading requires png.js and zlib.js.

This (png_zlib_worker_min.js) is now included in this repo's "Optional" directory and is all you need.

source:  http://github.com/devongovett/png.js/


####Optional Configuration - Multithreading
Multithreading support is optional, and available via an inlined Web Worker.

Multithreading may not clearly be worth the headache of configuring it in all cases; you do not need to use it.

Multithreading is not compatible with HTML 5 Canvas.  HTML 5 Canvas will only run on the main thread.

Multithreading will not work if full lazy load mode is enabled; the overhead of serializing copies is too high.

Multithreading support requires three include files which can be specified in the LBITSOptions object.  (bitstore.js, zlib.js, modified png.js)

When specifying the URL for these, note it must be absolute for an inlined worker.

Using a minified or combined version is fine; however, the correct URL must be specified.


####Optional Configuration - Image Processing
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

####Optional Configuration - Image Processing - Stroke Recovery
(not that kind)

###### Actual example: the following tile has first had the shadow effect removed, then the NODATA fill.

PNG  | Bitmap Index
---- | ----
![227,99@8png](https://github.com/Safecast/bitstore.js/raw/master/images/TileExport_8_227_99.png) | ![227,99@8gif](https://github.com/Safecast/bitstore.js/raw/master/images/TileExport_8_227_99.gif)


###### Details

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
