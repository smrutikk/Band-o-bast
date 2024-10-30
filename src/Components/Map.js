import React, { useEffect, useState } from 'react';
import L from 'leaflet';
import { db } from '../config/firebaseConfig';
import { ref, onValue, push, set, get, update } from 'firebase/database';

import customMarkerIcon from '../maps-flags_447031.png';

import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw/dist/leaflet.draw.js';
import 'leaflet-control-geocoder/dist/Control.Geocoder.css';
import 'leaflet-control-geocoder/dist/Control.Geocoder.js';

const Map = () => {
  const mapRef = React.useRef();
  const [drawnLayers, setDrawnLayers] = useState([]);
  const [bandobastDetails, setBandobastDetails] = useState({
    title: '',
    personnel: [],
    date: '',
    startTime: '',
    endTime: '',
    coordinates: [],
    circle: null
  });
  const [showForm, setShowForm] = useState(false);
  const [personnelOptions, setPersonnelOptions] = useState([]);

  useEffect(() => {
    const map = L.map('map').setView([20.5937, 78.9629], 5);
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    const geocoder = L.Control.Geocoder.nominatim();
    L.Control.geocoder({
      geocoder: geocoder,
      position: 'topright',
      placeholder: 'Search for location...'
    }).addTo(map);

    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    const drawControl = new L.Control.Draw({
      draw: {
        rectangle: true,
        polygon: true,
        polyline: true,
        circle: true,
        marker: {
          icon: new L.Icon({
            iconUrl: customMarkerIcon,
            iconSize: [32, 32],
            iconAnchor: [16, 32],
          }),
        },
      },
      edit: {
        featureGroup: drawnItems,
        remove: true,
      },
    });
    map.addControl(drawControl);

    map.on('draw:created', function (event) {
      const { layer, layerType } = event;
      
      switch (layerType) {
        case 'rectangle':
        case 'polygon':
        case 'polyline':
          const polygonGeometry = layer.toGeoJSON().geometry;
          if (validateCoordinates(polygonGeometry.coordinates)) {
            drawnItems.addLayer(layer);
            setDrawnLayers([...drawnLayers, layer]);
            setBandobastDetails({ ...bandobastDetails, geometry: polygonGeometry });
            setShowForm(true);
          }
          break;
        case 'circle':
          const circleData = {
            center: layer.getLatLng(),
            radius: layer.getRadius(),
          };
          if (circleData.center && circleData.radius) {
            drawnItems.addLayer(layer);
            setDrawnLayers([...drawnLayers, layer]);
            setBandobastDetails({ ...bandobastDetails, circle: circleData });
            setShowForm(true);
          }
          break;
        case 'marker':
          const markerLatLng = layer.getLatLng();
          if (markerLatLng.lat && markerLatLng.lng) {
            drawnItems.addLayer(layer);
            setDrawnLayers([...drawnLayers, layer]);
            const markerData = layer.toGeoJSON();
            setBandobastDetails({ ...bandobastDetails, marker: markerData });
            setShowForm(true);
          } else {
            console.warn('Marker coordinates are undefined');
          }
          break;
      }
    });

    function addPopupToSector(layer, sectorName) {
      layer.bindPopup(sectorName);
    }

    const bandobastRef = ref(db, 'bandobastDetails');
    onValue(bandobastRef, (snapshot) => {
      const bandobastData = snapshot.val();
      if (bandobastData) {
        Object.values(bandobastData).forEach(sector => {
          const { coordinates, title, circle, personnel } = sector;
          if (circle && circle.center) {
            const { center, radius } = circle;
            const circleLayer = L.circle(center, { radius }).addTo(mapRef.current);
            addPopupToSector(circleLayer, title);
          } else if (coordinates && validateCoordinates(coordinates)) {
            coordinates.forEach(coord => {
              const sectorLayer = L.geoJSON({
                type: 'Feature',
                geometry: {
                  type: 'Polygon',
                  coordinates: coord,
                },
              }).addTo(mapRef.current);
              addPopupToSector(sectorLayer, title);
            });
          }
          if (personnel) {
            Object.values(personnel).forEach(person => {
              if (person.latitude && person.longitude) {
                const marker = L.marker([person.latitude, person.longitude], {
                  icon: new L.Icon({
                    iconUrl: customMarkerIcon,
                    iconSize: [32, 32],
                    iconAnchor: [16, 32],
                  })
                }).addTo(mapRef.current);
                marker.bindPopup(person.name);
              } else {
                console.warn('Personnel coordinates are undefined:', person);
              }
            });
          }
        });
      }
    });

    const personnelRef = ref(db, 'personnel');
    onValue(personnelRef, (snapshot) => {
      const personnelData = snapshot.val();
      if (personnelData) {
        const options = Object.keys(personnelData).map(key => ({
          value: key,
          label: personnelData[key].name
        }));
        setPersonnelOptions(options);
      }
    });

    return () => {
      map.remove();
    };
  }, []);

  const validateCoordinates = (coordinates) => {
    return (
      Array.isArray(coordinates) &&
      coordinates.every(
        (point) =>
          Array.isArray(point) &&
          point.length >= 2 &&
          typeof point[0] === 'number' &&
          typeof point[1] === 'number'
      )
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const coordinates = drawnLayers.map(layer => layer.toGeoJSON().geometry.coordinates);
  
      const updatedBandobastDetails = {
        ...bandobastDetails,
        coordinates: coordinates
      };
  
      const personnelIds = bandobastDetails.personnel;
      const personnelPromises = personnelIds.map(personnelId => {
        const personnelRef = ref(db, `personnel/${personnelId}`);
        return get(personnelRef).then(snapshot => snapshot.val());
      });
  
      const personnelDetails = await Promise.all(personnelPromises);
  
      const updatedPersonnelData = {};
      personnelDetails.forEach(person => {
        updatedPersonnelData[person.deviceId] = {
          latitude: person.latitude,
          longitude: person.longitude
        };
      });
  
      const updatedBandobastWithPersonnel = {
        ...updatedBandobastDetails,
        personnel: updatedPersonnelData
      };
  
      const bandobastRef = ref(db, 'bandobastDetails');
      const newBandobastRef = push(bandobastRef);
      await set(newBandobastRef, updatedBandobastWithPersonnel);
  
      setShowForm(false);
      alert('Data saved successfully!');
      setBandobastDetails({
        title: '',
        personnel: [],
        date: '',
        startTime: '',
        endTime: '',
        circle: null
      });
    } catch (error) {
      console.error('Error saving data: ', error);
      alert('Error saving data: ' + error.message);
    }
  };
  
  const handleSelectPersonnel = (e) => {
    const selectedOptions = Array.from(e.target.selectedOptions, option => option.value);
    setBandobastDetails(prevState => ({
      ...prevState,
      personnel: selectedOptions,
    }));
  };

  const handleCloseForm = () => {
    setShowForm(false);
  };

  return (
    <div>
      <div id="map" style={{ height: '600px' }}></div>
      {showForm && (
        <div style={{ position: 'absolute', top: '20%', left: '50%', transform: 'translate(-50%, -20%)', backgroundColor: 'white', padding: '20px', border: '1px solid #ccc', borderRadius: '5px', boxShadow: '0 0 10px rgba(0, 0, 0, 0.1)', zIndex: 1000 }}>
          <button style={{ position: 'absolute', top: '5px', right: '5px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '1.2em' }} onClick={handleCloseForm}>×</button>
          <h2>Bandobast Details</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Title:</label>
              <input type="text" name="title" value={bandobastDetails.title} onChange={(e) => setBandobastDetails({ ...bandobastDetails, title: e.target.value })} required style={{ width: '100%', padding: '8px', marginBottom: '10px', borderRadius: '5px', border: '1px solid #ccc' }} />
            </div>
            <div className="form-group">
              <label>Personnel:</label>
              <select multiple name="personnel" value={bandobastDetails.personnel} onChange={handleSelectPersonnel} style={{ width: '100%', padding: '8px', marginBottom: '10px', borderRadius: '5px', border: '1px solid #ccc' }}>
                {personnelOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Date:</label>
              <input type="date" name="date" value={bandobastDetails.date} onChange={(e) => setBandobastDetails({ ...bandobastDetails, date: e.target.value })} style={{ width: '100%', padding: '8px', marginBottom: '10px', borderRadius: '5px', border: '1px solid #ccc' }} />
            </div>
            <div className="form-group">
              <label>Start Time:</label>
              <input type="time" name="startTime" value={bandobastDetails.startTime} onChange={(e) => setBandobastDetails({ ...bandobastDetails, startTime: e.target.value })} style={{ width: '100%', padding: '8px', marginBottom: '10px', borderRadius: '5px', border: '1px solid #ccc' }} />
            </div>
            <div className="form-group">
              <label>End Time:</label>
              <input type="time" name="endTime" value={bandobastDetails.endTime} onChange={(e) => setBandobastDetails({ ...bandobastDetails, endTime: e.target.value })} style={{ width: '100%', padding: '8px', marginBottom: '10px', borderRadius: '5px', border: '1px solid #ccc' }} />
            </div>
            <button type="submit" style={{ width: '100%', padding: '10px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>Save Bandobast</button>
          </form>
        </div>
      )}
    </div>
  );
};

export default Map;
