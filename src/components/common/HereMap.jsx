import React, { useEffect, useRef, useState } from 'react';
import { HERE_API_KEY_FRONTEND } from '../../config';

/**
 * Base interactive HERE Map component
 * 
 * @param {Object} props
 * @param {string} props.containerId - ID for the map container div
 * @param {Object} props.center - {lat, lng} for map center
 * @param {number} props.zoom - Initial zoom level (default: 10)
 * @param {Array} props.markers - Array of {lat, lng, label, icon} objects
 * @param {string} props.polyline - Encoded polyline string for route
 * @param {Function} props.onMapReady - Callback when map is initialized
 * @param {Function} props.onMarkerClick - Callback when marker is clicked
 * @param {string} props.height - Map height (default: '400px')
 * @param {string} props.width - Map width (default: '100%')
 */
export default function HereMap({
  containerId = 'here-map',
  center = { lat: 40.7128, lng: -74.0060 }, // Default: NYC
  zoom = 10,
  markers = [],
  polyline = null,
  onMapReady = null,
  onMarkerClick = null,
  autoFitMarkers = true,
  autoCenterSingleMarker = true,
  singleMarkerZoom = null,
  height = '400px',
  width = '100%'
}) {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const [mapInstance, setMapInstance] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadingError, setLoadingError] = useState(null);

  useEffect(() => {
    let initTimer;
    let isMounted = true;

    // Global promise to track script loading
    if (!window.hereMapsLoadingPromise) {
      window.hereMapsLoadingPromise = new Promise((resolve, reject) => {
        // Check if already loaded
        if (window.H && window.H.service && window.H.ui) {
          resolve();
          return;
        }

        // Check if scripts are already being loaded
        if (window.hereMapsLoading) {
          const checkInterval = setInterval(() => {
            if (window.H && window.H.service && window.H.ui) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);
          return;
        }

        window.hereMapsLoading = true;

        // Load HERE Maps scripts in order
        const scripts = [
          'https://js.api.here.com/v3/3.1/mapsjs-core.js',
          'https://js.api.here.com/v3/3.1/mapsjs-service.js',
          'https://js.api.here.com/v3/3.1/mapsjs-ui.js',
          'https://js.api.here.com/v3/3.1/mapsjs-mapevents.js'
        ];

        let loadedCount = 0;
        let hasError = false;

        const loadScript = (index) => {
          if (hasError || index >= scripts.length) {
            if (loadedCount === scripts.length) {
              // Wait a bit for scripts to initialize
              setTimeout(() => {
                if (window.H && window.H.service && window.H.ui) {
                  window.hereMapsLoading = false;
                  resolve();
                } else {
                  window.hereMapsLoading = false;
                  reject(new Error('HERE Maps API failed to initialize'));
                }
              }, 200);
            }
            return;
          }

          // Check if script already exists
          const existingScript = document.querySelector(`script[src="${scripts[index]}"]`);
          if (existingScript) {
            loadedCount++;
            loadScript(index + 1);
            return;
          }

          const script = document.createElement('script');
          script.src = scripts[index];
          script.async = false; // Load sequentially
          script.onload = () => {
            loadedCount++;
            loadScript(index + 1);
          };
          script.onerror = () => {
            hasError = true;
            window.hereMapsLoading = false;
            reject(new Error(`Failed to load HERE Maps script: ${scripts[index]}`));
          };
          document.head.appendChild(script);
        };

        loadScript(0);
      });
    }

    const initializeMap = () => {
      if (!isMounted) return;

      const container = document.getElementById(containerId);
      if (!container) {
        console.error(`Map container with id "${containerId}" not found`);
        if (isMounted) {
          setLoadingError(`Map container not found: ${containerId}`);
        }
        return;
      }

      if (!window.H || !window.H.service || !window.H.ui) {
        console.error('HERE Maps API not loaded');
        if (isMounted) {
          setLoadingError('HERE Maps API failed to load. Please check your API key and network connection.');
        }
        return;
      }

      if (!HERE_API_KEY_FRONTEND) {
        const msg = 'Missing HERE API key. Set VITE_HERE_API_KEY_FRONTEND in the Vite .env and restart the frontend dev server.';
        console.error(msg);
        if (isMounted) {
          setLoadingError(msg);
        }
        return;
      }

      try {
        const platform = new window.H.service.Platform({
          apikey: HERE_API_KEY_FRONTEND
        });

        const defaultLayers = platform.createDefaultLayers();
        const map = new window.H.Map(
          container,
          defaultLayers.vector.normal.map,
          {
            center: { lat: center.lat, lng: center.lng },
            zoom: zoom,
            pixelRatio: window.devicePixelRatio || 1
          }
        );

        // Add map behavior
        const behavior = new window.H.mapevents.Behavior(
          new window.H.mapevents.MapEvents(map)
        );

        // Add UI
        const ui = window.H.ui.UI.createDefault(map, defaultLayers);

        // Add markers
        if (markers && markers.length > 0) {
          markers.forEach((marker, index) => {
            const icon = new window.H.map.Icon(
              marker.icon || 'https://cdn-icons-png.flaticon.com/512/684/684908.png',
              { size: { w: 32, h: 32 } }
            );
            const mapMarker = new window.H.map.Marker(
              { lat: marker.lat, lng: marker.lng },
              { icon: icon, data: marker }
            );
            
            if (onMarkerClick) {
              mapMarker.addEventListener('tap', () => onMarkerClick(marker));
            }
            
            map.addObject(mapMarker);
          });

          // Adjust viewport
          if (autoFitMarkers && markers.length > 1) {
            const group = new window.H.map.Group();
            markers.forEach(m => {
              group.addObject(new window.H.map.Marker({ lat: m.lat, lng: m.lng }));
            });
            map.getViewModel().setLookAtData({
              bounds: group.getBoundingBox()
            });
          } else if (autoCenterSingleMarker && markers.length === 1) {
            const m = markers[0];
            try {
              map.getViewModel().setLookAtData({
                position: { lat: m.lat, lng: m.lng },
                zoom: Number.isFinite(Number(singleMarkerZoom)) ? Number(singleMarkerZoom) : zoom,
              });
            } catch (e) {
              // ignore
            }
          }
        }

        // Add polyline if provided
        if (polyline) {
          try {
            const decoded = window.H.geo.LineString.fromFlexiblePolyline(polyline);
            const polylineObj = new window.H.map.Polyline(decoded, {
              style: {
                strokeColor: '#2563eb',
                lineWidth: 4
              }
            });
            map.addObject(polylineObj);
            map.getViewModel().setLookAtData({
              bounds: polylineObj.getBoundingBox()
            });
          } catch (e) {
            console.error('Error rendering polyline:', e);
          }
        }

        if (isMounted) {
          setMapInstance(map);
          setIsLoaded(true);
        }
        
        if (onMapReady) {
          onMapReady(map);
        }

        // Resize map on window resize
        const resizeHandler = () => map.getViewPort().resize();
        window.addEventListener('resize', resizeHandler);

        // Store resize handler for cleanup
        map._resizeHandler = resizeHandler;
      } catch (error) {
        console.error('Error initializing HERE Map:', error);
        if (isMounted) {
          setLoadingError(`Map initialization error: ${error.message}`);
        }
      }
    };

    // Wait for DOM to be ready, then load scripts and initialize
    initTimer = setTimeout(() => {
      window.hereMapsLoadingPromise
        .then(() => {
          // Small delay to ensure everything is ready
          setTimeout(() => {
            if (isMounted) {
              initializeMap();
            }
          }, 100);
        })
        .catch((error) => {
          console.error('Failed to load HERE Maps:', error);
          if (isMounted) {
            setLoadingError(error.message || 'Failed to load map');
          }
        });
    }, 100);

    // Cleanup
    return () => {
      isMounted = false;
      if (initTimer) {
        clearTimeout(initTimer);
      }
      if (mapInstance) {
        if (mapInstance._resizeHandler) {
          window.removeEventListener('resize', mapInstance._resizeHandler);
        }
        mapInstance.dispose();
      }
    };
  }, [containerId, center.lat, center.lng, zoom]);

  // Update markers when they change
  useEffect(() => {
    if (!mapInstance || !isLoaded || !markers.length) return;

    // Remove existing markers
    mapInstance.getObjects().forEach(obj => {
      if (obj instanceof window.H.map.Marker) {
        mapInstance.removeObject(obj);
      }
    });

    // Add new markers
    markers.forEach((marker) => {
      const icon = new window.H.map.Icon(
        marker.icon || 'https://cdn-icons-png.flaticon.com/512/684/684908.png',
        { size: { w: 32, h: 32 } }
      );
      const mapMarker = new window.H.map.Marker(
        { lat: marker.lat, lng: marker.lng },
        { icon: icon, data: marker }
      );
      
      if (onMarkerClick) {
        mapMarker.addEventListener('tap', () => onMarkerClick(marker));
      }
      
      mapInstance.addObject(mapMarker);
    });

    // Fit to bounds
    if (autoFitMarkers && markers.length > 1) {
      const group = new window.H.map.Group();
      markers.forEach(m => {
        group.addObject(new window.H.map.Marker({ lat: m.lat, lng: m.lng }));
      });
      mapInstance.getViewModel().setLookAtData({
        bounds: group.getBoundingBox()
      });
    } else if (autoCenterSingleMarker && markers.length === 1) {
      const m = markers[0];
      try {
        mapInstance.getViewModel().setLookAtData({
          position: { lat: m.lat, lng: m.lng },
          zoom: Number.isFinite(Number(singleMarkerZoom)) ? Number(singleMarkerZoom) : zoom,
        });
      } catch (e) {
        // ignore
      }
    }
  }, [markers, mapInstance, isLoaded, onMarkerClick, autoFitMarkers, autoCenterSingleMarker, singleMarkerZoom, zoom]);

  // Update polyline when it changes
  useEffect(() => {
    if (!mapInstance || !isLoaded || !polyline) return;

    // Remove existing polylines
    mapInstance.getObjects().forEach(obj => {
      if (obj instanceof window.H.map.Polyline) {
        mapInstance.removeObject(obj);
      }
    });

    try {
      const decoded = window.H.geo.LineString.fromFlexiblePolyline(polyline);
      const polylineObj = new window.H.map.Polyline(decoded, {
        style: {
          strokeColor: '#2563eb',
          lineWidth: 4
        }
      });
      mapInstance.addObject(polylineObj);
      mapInstance.getViewModel().setLookAtData({
        bounds: polylineObj.getBoundingBox()
      });
    } catch (e) {
      console.error('Error rendering polyline:', e);
    }
  }, [polyline, mapInstance, isLoaded]);

  if (loadingError) {
    return (
      <div
        style={{
          width: width,
          height: height,
          minHeight: '300px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f3f4f6',
          color: '#dc2626',
          border: '1px solid #e5e7eb',
          borderRadius: '8px'
        }}
      >
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <div style={{ fontSize: '14px', marginBottom: '8px' }}>⚠️ Map Loading Error</div>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>{loadingError}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      id={containerId}
      style={{
        width: width,
        height: height,
        minHeight: '300px',
        position: 'relative',
        backgroundColor: isLoaded ? 'transparent' : '#f9fafb',
        border: isLoaded ? 'none' : '1px solid #e5e7eb',
        borderRadius: '8px',
        display: 'flex',
        alignItems: isLoaded ? 'stretch' : 'center',
        justifyContent: isLoaded ? 'stretch' : 'center'
      }}
    >
      {!isLoaded && (
        <div style={{ 
          textAlign: 'center', 
          color: '#6b7280',
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10
        }}>
          <div style={{ fontSize: '14px' }}>Loading map...</div>
        </div>
      )}
    </div>
  );
}
