/*
 * CUSF Landing Prediction Version 3
 * Mark Jessop 2019
 * vk5qi@rfhead.net
 *
 * http://github.com/jonsowman/cusf-standalone-predictor
 *
 */


function initLaunchCard(){
    // Initialise the time/date on the launch card.

    // var today = new Date();

    // $('#year').val(today.getFullYear());
    // $('#day').val(today.getDate());
    // var month = today.getMonth()+1;
    // $("#month").val(month).change();
    // $('#hour').val(today.getHours());
    // $('#min').val(today.getMinutes());
    // $('#sec').val(today.getSeconds());

    var today = moment.utc().add(9, 'hour');

    $('#year').val(today.year());
    $('#day').val(today.date());
    var month = today.month()+1;
    $("#month").val(month).change();
    $('#hour').val(today.hours());
    $('#min').val(today.minutes());
}


function runPrediction(){
    // Read the user-supplied parameters and request a prediction.
    var run_settings = {};
    var extra_settings = {};
    run_settings.profile = $('#flight_profile').val();
    run_settings.pred_type = $('#prediction_type').val();
    
    // Grab date values
    var year = $('#year').val();
    var month = $('#month').val();
    var day = $('#day').val();
    var hour = $('#hour').val();
    var minute = $('#min').val();

    // Months are zero-indexed in Javascript. Wat.
    var launch_time = moment.utc([year, month-1, day, hour, minute, 0, 0]);
    launch_time.subtract(9, 'hour');
    run_settings.launch_datetime = launch_time.format();
    extra_settings.launch_moment = launch_time;

    // Sanity check the launch date to see if it's not too far into the past or future.
    if(launch_time < (moment.utc().subtract(12, 'hours'))){
        throwError("Launch time too old (outside of model time range).");
        return;
    }
    if(launch_time > (moment.utc().add(7, 'days'))){
        throwError("Launch time too far into the future (outside of model time range).");
        return;
    }

    // Grab other launch settings.
    run_settings.launch_latitude = parseFloat($('#lat').val());
    run_settings.launch_longitude = parseFloat($('#lon').val());
    // Handle negative longitudes - Tawhiri wants longitudes between 0-360
    if (run_settings.launch_longitude < 0.0){
        run_settings.launch_longitude += 360.0
    }
    run_settings.launch_altitude = parseFloat($('#initial_alt').val());
    run_settings.ascent_rate = parseFloat($('#ascent').val());

    if (run_settings.profile == "standard_profile"){
        run_settings.burst_altitude = parseFloat($('#burst').val());
        run_settings.descent_rate = parseFloat($('#drag').val());
    } else {
        run_settings.float_altitude = parseFloat($('#burst').val());
        run_settings.stop_datetime = launch_time.add(1, 'days').format();
    }


    // Update the URL with the supplied parameters.
    url = new URL(window.location.href);
    // Should probably clear all these parameters before setting them again?
    if (time_was_now){
        url.searchParams.set('launch_datetime','now');
    }else {
        url.searchParams.set('launch_datetime', run_settings.launch_datetime);
    }
    url.searchParams.set('launch_latitude', run_settings.launch_latitude);
    url.searchParams.set('launch_longitude', run_settings.launch_longitude);
    url.searchParams.set('launch_altitude', run_settings.launch_altitude);
    url.searchParams.set('ascent_rate', run_settings.ascent_rate);
    url.searchParams.set('profile', run_settings.profile);
    url.searchParams.set('prediction_type', run_settings.pred_type);
    if (run_settings.profile == "standard_profile"){
        url.searchParams.set('burst_altitude', run_settings.burst_altitude);
        url.searchParams.set('descent_rate', run_settings.descent_rate);
    } else {
        url.searchParams.set('float_altitude', run_settings.float_altitude);
    }

    // Update browser URL.
    history.replaceState(
        {},
        'CUSF / SondeHub Predictor',
        url.href
    );


    // Run the request
    tawhiriRequest(run_settings, extra_settings);

}

// Tawhiri API URL. Refer to API docs here: https://tawhiri.readthedocs.io/en/latest/api.html
// Habitat Tawhiri Instance
//var tawhiri_api = "https://predict.cusf.co.uk/api/v1/";
// Sondehub Tawhiri Instance
var tawhiri_api = "https://api.v2.sondehub.org/tawhiri";
// Approximately how many hours into the future the model covers.
var MAX_PRED_HOURS = 169;

function tawhiriRequest(settings, extra_settings){
    // Request a prediction via the Tawhiri API.
    // Settings must be as per the API docs above.

    if(settings.pred_type=='single'){
        hourly_mode = false;
        $.get( tawhiri_api, settings )
            .done(function( data ) {
                processTawhiriResults(data, settings);
            })
            .fail(function(data) {
                var prediction_error = "Prediction failed. Tawhiri may be under heavy load, please try again. ";
                if(data.hasOwnProperty("responseJSON"))
                {
                    prediction_error += data.responseJSON.error.description;
                }

                throwError(prediction_error);
            })
            .always(function(data) {
                //throwError("test.");
                //console.log(data);
            });
    } else {
        // For Multiple predictions, we do things a bit differently.
        hourly_mode = true;
        // First up clear off anything on the map.
        clearMapItems();

        // Also clean up any hourly prediction data.
        hourly_predictions = {};

        var current_hour = 0;
        var time_step = 24;

        if(settings.pred_type=='daily'){
            time_step = 24;
        } else if (settings.pred_type=='1_hour'){
            time_step = 1;
        } else if (settings.pred_type=='3_hour'){
            time_step = 3;
        } else if (settings.pred_type=='6_hour'){
            time_step = 6;
        } else if (settings.pred_type=='12_hour'){
            time_step = 12;
        } else {
            throwError("Invalid time step.");
            return;
        }

        if(settings.profile != "standard_profile"){
            throwError("Hourly/Daily predictions are only available for the standard flight profile.");
            return;
        }

        // Loop to advance time until end of prediction window
        while(current_hour < MAX_PRED_HOURS){
            // Update launch time
            var current_moment = moment(extra_settings.launch_moment).add(current_hour, 'hours');

            // Setup entries in the hourly prediction data store.
            hourly_predictions[current_hour] = {};
            hourly_predictions[current_hour]['layers'] = {};
            hourly_predictions[current_hour]['settings'] = {...settings};
            hourly_predictions[current_hour]['settings']['launch_datetime'] = current_moment.format();
            
            // Copy our current settings for passing into the requst.
            var current_settings = {...hourly_predictions[current_hour]['settings']};

            $.get( {url:tawhiri_api, 
                data: current_settings, 
                current_hour: current_hour} )
                .done(function( data ) {
                    processHourlyTawhiriResults(data, current_settings, this.current_hour);
                })
                .fail(function(data) {
                    var prediction_error = "Prediction failed. Tawhiri may be under heavy load, please try again. ";
                    if(data.hasOwnProperty("responseJSON"))
                    {
                        prediction_error += data.responseJSON.error.description;
                    }

                    // Silently handle failed predictions, which are most likely
                    // because the prediction time was too far into the future.
                    delete hourly_predictions[this.current_hour]
                    //throwError(prediction_error);
                })
                .always(function(data) {
                    //throwError("test.");
                    //console.log(data);
                });

            current_hour += time_step;

        }

            // Generate prediction number and information to pass onwards to plotting
            // Run async get call, pass in prediction details.

            // Need new processing functions to plot just the landing spot, and then somehow a line between them?
            

    }
}

function processTawhiriResults(data, settings){
    // Process results from a Tawhiri run.

    if(data.hasOwnProperty('error')){
        // The prediction API has returned an error.
        throwError("Predictor returned error: "+ data.error.description)
    } else {

        var prediction_results = parsePrediction(data.prediction);

        plotStandardPrediction(prediction_results);

        writePredictionInfo(settings, data.metadata, data.request);
        
    }

    //console.log(data);

}

function parsePrediction(prediction){
    // Convert a prediction in the Tawhiri API format to a Polyline.

    var flight_path = [];
    var launch = {};
    var burst = {};
    var landing = {};

    var ascent =  prediction[0].trajectory;
    var descent =  prediction[1].trajectory;

    // Add the ascent track to the flight path array.
    ascent.forEach(function (item, index){
        var _lat = item.latitude;
        // Correct for API giving us longitudes outside [-180, 180]
        var _lon = item.longitude;
        if (_lon > 180.0){
            _lon = _lon - 360.0;
        }

        flight_path.push([_lat, _lon, item.altitude]);
    });

    // Add the Descent or Float track to the flight path array.
    descent.forEach(function (item, index){
        var _lat = item.latitude;
        var _lon = item.longitude;
        // Correct for API giving us longitudes outside [-180, 180]
        if (_lon > 180.0){
            _lon = _lon - 360.0;
        }

        flight_path.push([_lat, _lon, item.altitude]);
    });

    // Populate the launch, burst and landing points
    var launch_obj = ascent[0];
    var _lon = launch_obj.longitude;
    if (_lon > 180.0){
        _lon = _lon - 360.0;
    }
    launch.latlng = L.latLng([launch_obj.latitude, _lon, launch_obj.altitude]);
    launch.datetime = moment.utc(launch_obj.datetime);

    var burst_obj = descent[0];
    var _lon = burst_obj.longitude;
    if (_lon > 180.0){
        _lon = _lon - 360.0;
    }
    burst.latlng = L.latLng([burst_obj.latitude, _lon, burst_obj.altitude]);
    burst.datetime = moment.utc(burst_obj.datetime);

    var landing_obj = descent[descent.length - 1];
    var _lon = landing_obj.longitude;
    if (_lon > 180.0){
        _lon = _lon - 360.0;
    }
    landing.latlng = L.latLng([landing_obj.latitude, _lon, landing_obj.altitude]);
    landing.datetime = moment.utc(landing_obj.datetime);

    var profile = null;
    if(prediction[1].stage == 'descent'){
        profile = 'standard_profile';
    } else {
        profile = 'float_profile';
    }

    var flight_time = landing.datetime.diff(launch.datetime, 'seconds');

    return {'flight_path': flight_path, 'launch': launch, 'burst': burst, 'landing':landing, 'profile': profile, 'flight_time': flight_time};
}

function plotStandardPrediction(prediction){

    appendDebug("Flight data parsed, creating map plot...");
    clearMapItems();

    var launch = prediction.launch;
    var landing = prediction.landing;
    var burst = prediction.burst;

    // Calculate range and time of flight
    var range = distHaversine(launch.latlng, landing.latlng, 1);
    var flighttime = "";
    var f_hours = Math.floor(prediction.flight_time / 3600);
    var f_minutes = Math.floor(((prediction.flight_time % 86400) % 3600) / 60);
    if ( f_minutes < 10 ) f_minutes = "0"+f_minutes;
    flighttime = f_hours + "hr" + f_minutes;
    $("#cursor_pred_range").html(range);
    $("#cursor_pred_time").html(flighttime);
    cursorPredShow();

    // Make some nice icons
    var launch_icon = L.icon({
        iconUrl: launch_img,
        iconSize: [10,10],
        iconAnchor: [5,5]
    });

    var land_icon = L.icon({
        iconUrl: land_img,
        iconSize: [10,10],
        iconAnchor: [5,5]
    });

    var burst_icon = L.icon({
        iconUrl: burst_img,
        iconSize: [16,16],
        iconAnchor: [8,8]
    });


    var launch_marker = L.marker(
        launch.latlng,
        {
            title: 'Balloon launch ('+launch.latlng.lat.toFixed(4)+', '+launch.latlng.lng.toFixed(4)+') at ' 
            + launch.datetime.format("HH:mm") + " UTC",
            icon: launch_icon
        }
    ).addTo(map);
    
    var land_marker = L.marker(
        landing.latlng,
        {
            title: 'Predicted Landing ('+landing.latlng.lat.toFixed(4)+', '+landing.latlng.lng.toFixed(4)+') at ' 
            + landing.datetime.format("HH:mm") + " UTC",
            icon: land_icon
        }
    ).addTo(map);

    var pop_marker = L.marker(
        burst.latlng,
        {
            title: 'Balloon burst ('+burst.latlng.lat.toFixed(4)+', '+burst.latlng.lng.toFixed(4)+ 
            ' at altitude ' + burst.latlng.alt.toFixed(0) + ') at ' 
            + burst.datetime.format("HH:mm") + " UTC",
            icon: burst_icon
        }
    ).addTo(map);

    var path_polyline = L.polyline(
        prediction.flight_path,
        {
            weight: 3,
            color: '#000000'
        }
    ).addTo(map);



    // Add the launch/land markers to map
    // We might need access to these later, so push them associatively
    map_items['launch_marker'] = launch_marker;
    map_items['land_marker'] = land_marker;
    map_items['pop_marker'] = pop_marker;
    map_items['path_polyline'] = path_polyline;

    // Pan to the new position
    map.setView(launch.latlng,8)

    return true;
}


// Populate and enable the download CSV, KML and Pan To links, and write the 
// time the prediction was run and the model used to the Scenario Info window
function writePredictionInfo(settings, metadata, request) {
    // populate the download links

    // Create the API URLs based on the current prediction settings
    _base_url = tawhiri_api + "?" + $.param(settings) 
    _csv_url = _base_url + "&format=csv";
    _kml_url = _base_url + "&format=kml";


    $("#dlcsv").attr("href", _csv_url);
    $("#dlkml").attr("href", _kml_url);
    $("#panto").click(function() {
            map.panTo(map_items['launch_marker'].getLatLng());
            //map.setZoom(7);
    });

    var run_time = moment.utc(metadata.complete_datetime).format();
    var dataset = moment.utc(request.dataset).format("YYYYMMDD-HH");


    $("#run_time").html(run_time);
    $("#dataset").html(dataset);
}


function processHourlyTawhiriResults(data, settings, current_hour){
    // Process results from a Tawhiri run.

    if(data.hasOwnProperty('error')){
        // The prediction API has returned an error.
        throwError("Predictor returned error: "+ data.error.description)
    } else {

        var prediction_results = parsePrediction(data.prediction);

        // Save prediction data into our hourly predictor data store.
        hourly_predictions[current_hour]['results'] = prediction_results;

        // Now plot...
        plotMultiplePrediction(prediction_results, current_hour);

        writeHourlyPredictionInfo(settings, data.metadata, data.request);
        
    }

    //console.log(data);

}

function plotMultiplePrediction(prediction, current_hour){

    var launch = prediction.launch;
    var landing = prediction.landing;
    var burst = prediction.burst;


    // Make some nice icons
    var launch_icon = L.icon({
        iconUrl: launch_img,
        iconSize: [10,10],
        iconAnchor: [5,5]
    });


    if(!map_items.hasOwnProperty("launch_marker")){
        var launch_marker = L.marker(
            launch.latlng,
            {
                title: 'Balloon launch ('+launch.latlng.lat.toFixed(4)+', '+launch.latlng.lng.toFixed(4)+')',
                icon: launch_icon
            }
        ).addTo(map);

        map_items['launch_marker'] = launch_marker;
    }

    var iconColour = ConvertRGBtoHex(evaluate_cmap((current_hour/MAX_PRED_HOURS), 'turbo'));
    var land_marker= new L.CircleMarker(landing.latlng, {
        radius: 5,
        fillOpacity: 1.0,
        zIndexOffset: 1000,
        fillColor: iconColour,
        stroke: true,
        weight: 1,
        color: "#000000",
        title: '<b>Launch Time: </b>' + launch.datetime.format() + '<br/>' + 'Predicted Landing ('+landing.latlng.lat.toFixed(4)+', '+landing.latlng.lng.toFixed(4)+')',
        current_hour: current_hour // Added in so we can extract this when we get a click event.
    }).addTo(map);

    var _base_url = tawhiri_api + "?" + $.param(hourly_predictions[current_hour]['settings']) 
    var _csv_url = _base_url + "&format=csv";
    var _kml_url = _base_url + "&format=kml";

    var predict_description =  '<b>Launch Time: </b>' + launch.datetime.format() + '<br/>' + 
    '<b>Predicted Landing:</b> '+landing.latlng.lat.toFixed(4)+', '+landing.latlng.lng.toFixed(4)+ '</br>' +
    '<b>Landing Time: </b>' + landing.datetime.format() + '<br/>' +
    '<b>Download: </b> <a href="'+_kml_url+'" target="_blank">KML</a>  <a href="'+_csv_url+'" target="_blank">CSV</a></br>';

    var landing_popup = new L.popup(
        { autoClose: false, 
            closeOnClick: false, 
        }).setContent(predict_description);
    land_marker.bindPopup(landing_popup);
    land_marker.on('click', showHideHourlyPrediction);

    hourly_predictions[current_hour]['layers']['landing_marker'] = land_marker;
    hourly_predictions[current_hour]['landing_latlng'] = landing.latlng;

    // Generate polyline latlons.
    landing_track = [];
    landing_track_complete = true;
    for (i in hourly_predictions){
        if(hourly_predictions[i]['landing_latlng']){
            landing_track.push(hourly_predictions[i]['landing_latlng']);
        }else{
            landing_track_complete = false;
        }
    }
    // If we dont have any undefined elements, plot.
    if(landing_track_complete){
        if(hourly_polyline){
            hourly_polyline.setLatLngs(landing_track);
        } else {
            hourly_polyline = L.polyline(
                landing_track,
                {
                    weight: 2,
                    zIndexOffset: 100,
                    color: '#000000'
                }
            ).addTo(map);
        }

        for (i in hourly_predictions){
            hourly_predictions[i]['layers']['landing_marker'].remove();
            hourly_predictions[i]['layers']['landing_marker'].addTo(map);
        }

        map.fitBounds(hourly_polyline.getBounds());
        map.setZoom(8);

        $("#cursor_pred_lastrun").show();

    }

    // var pop_marker = L.marker(
    //     burst.latlng,
    //     {
    //         title: 'Balloon burst ('+burst.latlng.lat.toFixed(4)+', '+burst.latlng.lng.toFixed(4)+ 
    //         ' at altitude ' + burst.latlng.alt.toFixed(0) + ') at ' 
    //         + burst.datetime.format("HH:mm") + " UTC",
    //         icon: burst_icon
    //     }
    // ).addTo(map);

    // var path_polyline = L.polyline(
    //     prediction.flight_path,
    //     {
    //         weight: 3,
    //         color: '#000000'
    //     }
    // ).addTo(map);



    // Pan to the new position
    // map.panTo(launch.latlng);
    // map.setZoom(8);

    return true;
}

function showHideHourlyPrediction(e){

    // Extract the current hour from the marker options.
    var current_hour = e.target.options.current_hour;
    var current_pred = hourly_predictions[current_hour]['results'];
    var landing = current_pred.landing;
    var launch = current_pred.launch;
    var burst = current_pred.burst;
    

    if(hourly_predictions[current_hour]['layers'].hasOwnProperty('flight_path')){
        // Flight path layer already exists, remove it and the burst icon.
        hourly_predictions[current_hour]['layers']['flight_path'].remove()
        hourly_predictions[current_hour]['layers']['pop_marker'].remove()
        delete hourly_predictions[current_hour]['layers'].flight_path;
        delete hourly_predictions[current_hour]['layers'].pop_marker;

    } else {
        // We need to make new icons.

        var burst_icon = L.icon({
            iconUrl: burst_img,
            iconSize: [16,16],
            iconAnchor: [8,8]
        });

        var pop_marker = L.marker(
            burst.latlng,
            {
                title: 'Balloon burst ('+burst.latlng.lat.toFixed(4)+', '+burst.latlng.lng.toFixed(4)+ 
                ' at altitude ' + burst.latlng.alt.toFixed(0) + ') at ' 
                + burst.datetime.format("HH:mm") + " UTC",
                icon: burst_icon,
                current_hour: current_hour
            }
        ).addTo(map);
        
        hourly_predictions[current_hour]['layers']['pop_marker'] = pop_marker;

        var path_polyline = L.polyline(
            current_pred.flight_path,
            {
                weight: 3,
                color: '#000000',
                current_hour: current_hour
            }
        ).addTo(map);
        path_polyline.on('click', showHideHourlyPrediction);

        hourly_predictions[current_hour]['layers']['flight_path'] = path_polyline;
    }

}

function writeHourlyPredictionInfo(settings, metadata, request) {
    // populate the download links

    // // Create the API URLs based on the current prediction settings
    // _base_url = tawhiri_api + "?" + $.param(settings) 
    // _csv_url = _base_url + "&format=csv";
    // _kml_url = _base_url + "&format=kml";


    // $("#dlcsv").attr("href", _csv_url);
    // $("#dlkml").attr("href", _kml_url);
    // $("#panto").click(function() {
    //         map.panTo(map_items['launch_marker'].getLatLng());
    //         //map.setZoom(7);
    // });

    var run_time = moment.utc(metadata.complete_datetime).format();
    var dataset = moment.utc(request.dataset).format("YYYYMMDD-HH");


    $("#run_time").html(run_time);
    $("#dataset").html(dataset);
}
