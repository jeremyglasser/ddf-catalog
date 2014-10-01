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
        'underscore',
        'js/view/Utils.js',
        'text!templates/textType.handlebars',
        'text!templates/passwordType.handlebars',
        'text!templates/numberType.handlebars',
        'text!templates/checkboxType.handlebars'
],
function (ich,Marionette,Backbone,_,Utils,textType,passwordType,numberType,checkboxType) {

    ich.addTemplate('textType', textType);
    ich.addTemplate('passwordType', passwordType);
    ich.addTemplate('numberType', numberType);
    ich.addTemplate('checkboxType', checkboxType);

    var ModalDetails = {
        Utils : Utils
    };

    ModalDetails.View = Marionette.Layout.extend({
        tagName: 'div',
        /**
         * Initialize  the binder with the ManagedServiceFactory model.
         * @param options
         */
        initialize: function(options) {
            _.bindAll(this);
        },
        onRender: function() {
            this.$el.attr('tabindex', "-1");
            this.renderDynamicFields();
            this.setupPopOvers();
        },
        /**
         * Set up the popovers based on if the selector has a description.
         */
        setupPopOvers: function() {
            var view = this;
            view.model.get('metatype').forEach(function(each) {
                if(!_.isUndefined(each.get("description"))) {
                    Utils.setupPopOvers(view.$el, each.id, each.get("name"), each.get("description"));
                }
            });
        },
        /**
         * Returns true if the metatype entry represents the unique ID for the model.
         */
        isIdField: function(metatype) {
            var val = metatype.get('id');
            return val === 'id' || val === 'shortname';
        },
        renderNameField: function() {
            var idModel = view.model.get('metatype').find(function(each) {
                return view.isIdField(each);
            });
            if (!_.isUndefined(idModel)) {
                view.$el.append(ich.textType(idModel.toJSON()));
            } else {
                //unable to find name field
            }
        },
        /**
         * Walk the collection of metatypes
         * Setup the ui based on the type
         * Append it to the bottom of this data-section selector
         */
        renderDynamicFields: function() {
            var view = this;
            //render the rest of the fields
            view.model.get('metatype').forEach(function(each) {
                var type = each.get("type");
                //TODO re-enable this when this functionality is added back in
//                var cardinality = each.get("cardinality"); //this is ignored for now and lists will be rendered as a ',' separated list
                if(!_.isUndefined(type) && !view.isIdField(each)) {
                    //from the Metatype specification
                    // int STRING = 1;
                    // int LONG = 2;
                    // int INTEGER = 3;
                    // int SHORT = 4;
                    // int CHARACTER = 5;
                    // int BYTE = 6;
                    // int DOUBLE = 7;
                    // int FLOAT = 8;
                    // int BIGINTEGER = 9;
                    // int BIGDECIMAL = 10;
                    // int BOOLEAN = 11;
                    // int PASSWORD = 12;
                    if (type === 1 || type === 5 || type === 6 || (type >= 7 && type <= 10)) {
                        view.$el.append(ich.textType(each.toJSON()));
                    }
                    else if (type === 11) {
                        view.$el.append(ich.checkboxType(each.toJSON()));
                    }
                    else if (type === 12) {
                        view.$el.append(ich.passwordType(each.toJSON()));
                    }
                    else if (type === 2 || type === 3 || type === 4) { //this type can only be used for integers
                        view.$el.append(ich.numberType(each.toJSON()));
                    }
                }
            });
        }
    });

    ModalDetails.Buttons = Marionette.ItemView.extend({
        template: 'sourceButtons',
        events: {
            'click .enable-button':'enableSource',
            'click .disable-button':'disableSource'
        },
        enableSource: function(){
            var view = this;
            view.model.get('currentConfiguration').set('enabled', true);
            view.render();
        },
        disableSource: function(){
            var view = this;
            view.model.get('currentConfiguration').set('enabled', false);
            view.render();
        }
    });

    return ModalDetails;

});