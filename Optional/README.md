Optional Files
==============

##What's this?

A pre-minified combo of zlib.js and png.js.  png.js has been modded especially to work in a background Web Worker thread.  (the standard png.js release will not)

These files are originally from: http://github.com/devongovett/png.js/

##So this will enable all optional functionality in bitstore.js?

Yes, but note for the web worker you still need to specify bitstore.js as well, and make sure the URLs for both are absolute.

##LESS WORDS MORE CODE OMG

First, in whatever is including bitstore.js already:

```
importScripts("png_zlib_worker_min.js");
```

Next, in your init for LBITs:

```
var pngsrc = "http://domain.org/stuff/png_zlib_worker_min.js";  // MUST be absolute path for inlined web worker
var bitsrc = "http://domain.org/stuff/bitstore.js";             // MUST be absolute path for inlined web worker

var opts   = new LBITSOptions({ multi:1, url0:pngsrc, url1:bitsrc });
```

##Can there be a bitstore_min.js?

Sure.  Just take the bitstore.js from up one directory and paste it into http://jscompress.com or similar.

##What got modified in png.js?

See below.

```
Line         New Code                      Comment
----------   -------------------------    ------------------------------------------------------------------------
- Line 25:   //(function() {              Disable the outer function wrapper, kill the "window" dependancy.
- Line 26:   //  var PNG;                 Disable the outer function wrapper, kill the "window" dependancy.
- Line 28:   var PNG = (function() {      Rework the inner function wrapper to be stand-alone.
- Line 361:  scratchCanvas = null;        Disable all explicit Canvas refs on init, kill the "document" dependancy.
- Line 362:  scratchCtx = null;           Disable all explicit Canvas refs on init, kill the "document" dependancy.
- Line 457:  //window.PNG = PNG;          Disable the outer function wrapper, kill the "window" dependancy.
- Line 459:  //}).call(this);             Disable the outer function wrapper, kill the "window" dependancy.
```

Note this breaks the HTML5 Canvas interop of png.js.  It is meant for background processing only.  It is not a replacement for the original.
