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
        'js/view/ModalSourceDetails.js',
        'js/model/Service.js',
        'wreqr',
        'underscore',
        'text!templates/sourceModal.handlebars',
        'text!templates/sourceButtons.handlebars',
        'text!templates/optionListType.handlebars'
],
function (ich,Marionette,Backbone,ModalDetails,Service,wreqr,_,modalSource,sourceButtons,optionListType) {

    ich.addTemplate('modalSource', modalSource);
    if (!ich.sourceButtons) {
        ich.addTemplate('sourceButtons', sourceButtons);
    }
    ich.addTemplate('optionListType', optionListType);

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
            details: '.modal-details',
            buttons: '.source-buttons'
        },

        /**
         * Initialize  the binder with the ManagedServiceFactory model.
         * @param options
         */
        initialize: function(options) {
            _.bindAll(this);
            this.modelBinder = new Backbone.ModelBinder();
        },
        onRender: function() {
            this.$el.attr('tabindex', "-1");
            this.$el.attr('role', "dialog");
            this.$el.attr('aria-hidden', "true");
            var currentConfig = this.model.get('currentConfiguration');
            this.renderTypeDropdown();
            if (!_.isNull(this.model) && !_.isUndefined(currentConfig)) {
                this.modelBinder.bind(currentConfig.get('properties'),
                        this.$el, Backbone.ModelBinder.createDefaultBindings(this.el, 'name'));
            }
        },
        /**
         * Renders the type dropdown box
         */
        renderTypeDropdown: function() {
            var $sourceTypeSelect = this.$(".sourceTypesSelect");
            var configs = this.getAllConfigs();
            $sourceTypeSelect.append(ich.optionListType({"list": configs.toJSON()}));
            $sourceTypeSelect.val(configs.at(0).get('id')).change();
        },
        getAllConfigs: function() {
            var configs = new Backbone.Collection();
            var disabledConfigs = this.model.get('disabledConfigurations');
            var currentConfig = this.model.get('currentConfiguration')
            if (!_.isUndefined(currentConfig)) {
                var currentService = currentConfig.get('service');
                configs.add(currentService);
            }
            if (!_.isUndefined(disabledConfigs)) {
                disabledConfigs.each(function(config) {
                    configs.add(config.get('service'));
                });
            }
            return configs;
        },
        /**
         * Submit to the backend.
         */
        submitData: function() {
            var model = this.model.get('editConfig');
            console.log('saving model');
            console.log(model);
            if (_.isUndefined(model.get('id'))) {
                if (!this.configExists(model)) {
                    model.save();
                } else {
                    //alert user of name collision
                }
            } else {
                //if model has id, we assume this is an edit/update
                model.save();
            }
            this.closeAndUnbind();
        },
        configExists: function(config) {
            var view = this;
            var model = view.model;
            var modelConfig = model.get('currentConfiguration');
            var matchFound = false;

            if (!_.isUndefined(modelConfig) && view.matches(modelConfig, config)) {
                matchFound = true;
            } else {
                matchFound = (undefined !== model.get('disabledConfigurations').find(function(modelConfig) {
                    return view.matches(modelConfig, config);
                }));
            }
            return matchFound;
        },
        /**
         * This method checks the two configs, returning true iff the 'id' (see getId method below) and 'fpid' match.
         */
        matches: function(aConfig, bConfig) {
            return this.getId(aConfig) === this.getId(bConfig) && aConfig.get('fpid') === bConfig.get('fpid');
        },
        //should be able to remove this method when the 'shortname' is removed from existing source metatypes
        getId: function(config) {
            var properties = config.get('properties');
            return properties.get('shortname') || properties.get('id');
        },
        closeAndUnbind: function() {
            this.modelBinder.unbind();
            this.$el.modal("hide");
        },
        /**
         * unbind the model and dom during close.
         */
        onClose: function () {
            this.modelBinder.unbind();
        },
        cancel: function() {
            this.closeAndUnbind();
        },
        handleTypeChange: function(evt) {
            var view = this;
            var $select = $(evt.currentTarget);
            if ($select.hasClass('sourceTypesSelect')) {
                this.modelBinder.unbind();
                var config = view.findConfigFromId($select.val());
                view.model.set('editConfig', config);
                
                view.renderDetails(config.get('service'));
                view.modelBinder.bind(config.get('properties'),
                      view.$el, Backbone.ModelBinder.createDefaultBindings(view.el, 'name'));
            }
        },
        findConfigFromId: function(id) {
            var model = this.model;
            var currentConfig = model.get('currentConfiguration');
            var disabledConfigs = model.get('disabledConfigurations');
            var config = undefined;
            if (!_.isUndefined(currentConfig) && currentConfig.get('fpid') === id) {
                config = currentConfig;
            } else {
                if (!_.isUndefined(disabledConfigs)) {
                    config = disabledConfigs.find(function(item) {
                        return item.get('service').get('id') === id;
                    });
                }
            }
            return config;
        },
        renderDetails: function(configuration) {
            var view = this;
            if (!_.isUndefined(configuration)) {
                this.details.show(new ModalDetails.View({
                    model: configuration,
                    id: configuration.get('id')
                }));
                this.buttons.show(new ModalDetails.Buttons({
                    model: view.model
                }));
            } else {
                $(this.details.el).html('');
                $(this.buttons.el).html('');
            }
        }
    });

    return ModalSource;

});