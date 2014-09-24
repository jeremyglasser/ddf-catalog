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
            if (!_.isNull(this.model)) {
                this.modelBinder.bind(this.model.get('currentConfiguration').get('properties'),
                        this.$el, Backbone.ModelBinder.createDefaultBindings(this.el, 'name'));
            }
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
                var detailsModel = _.find(collection, function(item) {
                    return item.get('id') === $select.val();
                });
                this.model = detailsModel;
                var config = new Service.Configuration();
                
                if (!_.isUndefined(detailsModel)) {
                    config.initializeFromMSF(this.model);
                    detailsModel.set('currentConfiguration', config);
                    view.$('.submit-button').removeAttr('disabled');
                } else {
                    view.$('.submit-button').attr('disabled','disabled');
                }
                view.renderDetails(detailsModel);
                view.modelBinder.bind(config.get('properties'),
                      view.$el, Backbone.ModelBinder.createDefaultBindings(view.el, 'name'));
            }
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