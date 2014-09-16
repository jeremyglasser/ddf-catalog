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
/** Main view page for add. */
define([
        'icanhaz',
        'marionette',
        'backbone',
        'js/view/ConfigurationEdit.view.js',
        'js/model/Service.js',
        'js/view/Utils.js',
        'wreqr',
        'underscore',
        'jquery',
        'text!templates/sourceModal.handlebars',
        'text!templates/optionListType.handlebars',
        'text!templates/textType.handlebars'
],
function (ich,Marionette,Backbone,ConfigurationEdit,Service,Utils,wreqr,_,$,modalSource,optionListType,textType) {

    ich.addTemplate('modalSource', modalSource);
    //these templates are part of the admin ui and we expect them to be there
    if(!ich.optionListType) {
        ich.addTemplate('optionListType', optionListType);
    }
    if(!ich.textType) {
        ich.addTemplate('textType', textType);
    }

    var ModalSource = {};

    ModalSource.View = Marionette.Layout.extend({
        template: 'modalSource',
        tagName: 'div',
        className: 'modal',
        /**
         * Button events, right now there's a submit button
         * I do not know where to go with the cancel button.
         */
        events: {
            "change .sourceTypesSelect" : "handleTypeChange",
            "click .submit-button": "submitData",
            "click .cancel-button": "cancel"
        },
        regions: {
            details: '.modal-details'
        },

        /**
         * Initialize  the binder with the ManagedServiceFactory model.
         * @param options
         */
        initialize: function(options) {
            _.bindAll(this);
            this.metatypes = options.metatypes;
            if (options.metatypes.length === 1) {
                this.model = options.metatypes[0];
            } else {
                this.model = null;
            }
            this.modelBinder = new Backbone.ModelBinder();
        },
        onRender: function() {
            this.$el.attr('tabindex', "-1");
            this.$el.attr('role', "dialog");
            this.$el.attr('aria-hidden', "true");
            this.renderTypeDropdown();
            if (!_.isNull(this.model) && !_.isUndefined(currentConfig)) {
                this.modelBinder.bind(currentConfig.get('properties'),
                        $boundData,
                        Backbone.ModelBinder.createDefaultBindings($boundData, 'name'));
            }
        },
        /**
         * Renders editable name field.
         */
        renderNameField: function() {
            var model = this.model;
            var $sourceName = this.$(".sourceName");
            var initialName = model.get('name') || 'New Configuration';
            var data = {
                id: model.id,
                name: 'Source Name',
                defaultValue: [initialName],
                description: 'Unique identifier for all source configurations of this type.'
            };
            model.set('name', initialName);
            $sourceName.append(ich.textType(data));
            $sourceName.val(data.defaultValue);
            Utils.setupPopOvers($sourceName, data.id, data.name, data.description);
        },
        /**
         * Renders the type dropdown box
         */
        renderTypeDropdown: function() {
            var $sourceTypeSelect = this.$(".sourceTypesSelect");
            var metatypes = this.metatypes;
            var configs = new Backbone.Collection();
            if (_.isArray(metatypes)) {
                if (metatypes.length === 1) {
                    var metatype = metatypes.pop();
                    var config = metatype.get('currentConfiguration');
                    configs.add(config);
                    $sourceTypeSelect.append(ich.optionListType({"list": configs.toJSON()}));
                    this.renderDetails(config.get('service'));
                } else {
                    _.each(metatypes, function(metatype) {
                        //if this doesn't have an fpid it isn't a managed service factory
                        //if it isn't a managed service factory then we can't select anything in the drop down
                        configs.add(metatype);
                    });
                    if (!_.isEmpty(configs)) {
                        $sourceTypeSelect.append(ich.optionListType({"list": {id : "none", name: "Select Type"}}));
                        $sourceTypeSelect.append(ich.optionListType({"list": configs.toJSON()}));
                    }
                }
            }
        },

        /**
         * Submit to the backend.
         */
        submitData: function() {
//            this.model.get('currentConfiguration').save();
            var model = this.model.get('currentConfiguration');
            model.save();
            this.cancel();
        },
        /**
         * unbind the model and dom during close.
         */
        onClose: function () {
            this.modelBinder.unbind();
        },
        cancel: function() {
            this.modelBinder.unbind();
            this.$el.modal("hide");
        },
        handleTypeChange: function(evt) {
            var view = this;
            var collection = view.metatypes; //view.model.get('collection');
            var $select = $(evt.currentTarget);
            if ($select.hasClass('sourceTypesSelect')) {
                this.modelBinder.unbind();
                var config = view.findConfigFromId($select.val());
                view.model.set('editConfig', config);

                var properties = config.get('properties');
                view.checkName(view.$('.sourceName').find('input').val().trim());
                view.renderDetails(config, config.get('service'));
                view.modelBinder.bind(properties, $boundData,
                      Backbone.ModelBinder.createDefaultBindings($boundData, 'name'));
            }
        },
        findConfigFromId: function(id) {
            var model = this.model;
            var currentConfig = model.get('currentConfiguration');
            var disabledConfigs = model.get('disabledConfigurations');
            var config = null;

            if (!_.isUndefined(currentConfig) && currentConfig.get('fpid') === id) {
                config = currentConfig;
            } else {
                if (!_.isUndefined(disabledConfigs)) {
                    config = disabledConfigs.find(function(item) {
                        var service = item.get('service');
                        if (!_.isUndefined(service) && !_.isNull(service)) {
                            return service.get('id') === id;
                        }
                        return false;
                    });
                }
            }
            return config;
        },
        renderDetails: function(model, configuration) {
            var toDisplay = configuration.get('metatype').filter(function(mt) {
                return !_.contains(['shortname', 'id', 'parameters'], mt.get('id'));
            });
            this.details.show(new ConfigurationEdit.ConfigurationCollection({
                collection: new Service.MetatypeList(toDisplay),
                service: configuration,
                configuration: this.model}));

        }
    });

    return ModalSource;

});