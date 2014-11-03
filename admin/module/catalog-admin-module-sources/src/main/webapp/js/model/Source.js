/**
 * Copyright (c) Codice Foundation
 *
 * This is free software: you can redistribute it and/or modify it under the terms of the GNU Lesser
 * General Public License as published by the Free Software Foundation, either version 3 of the
 * License, or any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
 * even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details. A copy of the GNU Lesser General Public License
 * is distributed along with this program and can be found at
 * <http://www.gnu.org/licenses/lgpl.html>.
 *
 **/
/*global define*/
define(function (require) {

    var Backbone = require('backbone'),
        Service = require('js/model/Service.js'),
        _ = require('underscore');

    require('backbonerelational');

    var Source = {};

    Source.ConfigurationList = Backbone.Collection.extend({
        model: Service.Configuration
    });

    Source.Model = Backbone.Model.extend({
        configUrl: "/jolokia/exec/org.codice.ddf.ui.admin.api.ConfigurationAdmin:service=ui",
        idAttribute: 'name',
        initialize: function() {
            this.set('currentConfiguration', undefined);
            this.set('disabledConfigurations', new Source.ConfigurationList());
        },
        addDisabledConfiguration: function(configuration) {
            if(this.get("disabledConfigurations")) {
                this.get("disabledConfigurations").add(configuration);
            }
            this.setNameFromConfig(configuration);
        },
        removeConfiguration: function(configuration) {
            if(this.get("disabledConfigurations").contains(configuration)) {
                this.stopListening(configuration);
                this.get("disabledConfigurations").remove(configuration);
            } else if (configuration === this.get("currentConfiguration")) {
                this.stopListening(configuration);
                this.set("currentConfiguration", undefined);
            }
        },
        setCurrentConfiguration: function(configuration) {
            this.set({currentConfiguration: configuration});
            this.setNameFromConfig(configuration);
        },
        setNameFromConfig: function(config) {
            if (!this.get('name') && !_.isUndefined(config) && !_.isUndefined(config.get('properties'))) {
                this.set('name', config.get('properties').get('shortname'));
            }
        },
        hasConfiguration: function(configuration) {
            var id = configuration.get('id');
            var curConfig = this.get('currentConfiguration');
            var hasConfig = false;

            var found = this.get("disabledConfigurations").find(function(config) {
                return config.get('fpid') === (id  + "_disabled");
            });
            if (_.isUndefined(found)) {
                if (!_.isUndefined(curConfig)) {
                    hasConfig = curConfig.get('fpid') === id;
                }
            } else {
                hasConfig = true;
            }
            return hasConfig;
        },
        initializeFromMSF: function(msf) {
            this.set({"fpid":msf.get("id")});
            this.set({"name":msf.get("name")});
            this.initializeConfigurationFromMetatype(msf.get("metatype"));
            this.configuration.set({"service.factoryPid": msf.get("id")});
        },
        initializeConfigurationFromMetatype: function(metatype) {
            var src = this;
            src.configuration = new Source.Configuration();
            metatype.forEach(function(obj){
                var id = obj.id;
                var val = obj.defaultValue;
                src.configuration.set(id, (val) ? val.toString() : null);
            });
        }
    });

    Source.Collection = Backbone.Collection.extend({
        model: Source.Model,
        addSource: function(configuration, enabled) {
            var source;
            var magicId = configuration.get("properties").get('shortname');
            if(!magicId){
                magicId = configuration.get("properties").get('id');
            }
            if(this.get(magicId)) {
                source = this.get(magicId);
            } else {
                source = new Source.Model({name: magicId});
                this.add(source);
            }
            if(enabled) {
                source.setCurrentConfiguration(configuration);
            } else {
                source.addDisabledConfiguration(configuration);
            }
            source.trigger('change');
        },
        removeSource: function(source) {
            this.stopListening(source);
            this.remove(source);
        },
        comparator: function(model) {
            var str = model.get('name') || '';
            return str.toLowerCase();
        },
    });

    Source.Response = Backbone.Model.extend({
        initialize: function(options) {
            if(options.model) {
                this.model = options.model;
                var collection = new Source.Collection();
                this.set({collection: collection});
                this.listenTo(this.model, 'change', this.parseServiceModel);
            }
        },
        parseServiceModel: function() {
            var resModel = this;
            var collection = resModel.get('collection');
            if(this.model.get("value")) {
                this.model.get("value").each(function(service) {
                    if(!_.isEmpty(service.get("configurations"))) {
                        service.get("configurations").each(function(configuration) {
                            if(configuration.get('fpid') && configuration.get('id') && configuration.get('fpid').indexOf('Source') !== -1){
                                if(configuration.get('fpid').indexOf('_disabled') === -1){
                                    collection.addSource(configuration, true);
                                } else {
                                    collection.addSource(configuration, false);
                                }
                            }
                        });
                    }
                });
            }
            collection.sort();
            collection.trigger('reset');
        },
        getSourceMetatypes: function() {
            var resModel = this;
            var metatypes = [];
            if(resModel.model.get('value')) {
                resModel.model.get('value').each(function(service) {
                var id = service.get('id');
                var name = service.get('name');
                if (!_.isUndefined(id) && id.indexOf('Source') !== -1 || !_.isUndefined(name) && name.indexOf('Source') !== -1) {
                    metatypes.push(service);
                }
                });
            }
            return metatypes;
        },
        /**
         * Returns a SourceModel that has all available source type configurations. Each source type configuration will be added as a 
         * disabledConfiguration and returned as part of the model. If an initialModel is presented, it will be modified to include any
         * missing configurations as part of its disabledConfigurations.
         */
        getSourceModelWithServices: function(initialModel) {
            var resModel = this;
            var serviceCollection = resModel.model.get('value');
            if (!initialModel) {
                initialModel = new Source.Model();
            }
            
            if(serviceCollection) {
                serviceCollection.each(function(service) {
                    var id = service.get('id');
                    var name = service.get('name');
                    if ((!_.isUndefined(id) && id.indexOf('Source') !== -1 || !_.isUndefined(name) && name.indexOf('Source') !== -1) && 
                            !initialModel.hasConfiguration(service)) {
                        var config = new Service.Configuration();
                        config.initializeFromService(service);
                        config.set('fpid', config.get('fpid') + '_disabled');
                        initialModel.addDisabledConfiguration(config);
                    } else {
                        //ensure name field is updated
                        if (!_.isUndefined(initialModel.get('currentConfiguration'))) {
                            initialModel.setNameFromConfig(initialModel.get('currentConfiguration'));
                        } else if (!_.isUndefined(initialModel.get('disabledConfigurations'))) {
                            initialModel.setNameFromConfig(initialModel.get('disabledConfigurations').at(0));
                        }
                    }
                });
            }
            return initialModel;
        },
        isSourceConfiguration: function(configuration) {
            return (configuration.get('fpid') && configuration.get('id') && configuration.get('fpid').indexOf('Source') !== -1);
        }
    });
    return Source;

});
