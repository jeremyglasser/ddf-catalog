define([
        'jquery'
],
function (jquery) {

    var Utils = {
            /**
             * Set up the popovers based on if the selector has a description.
             */
            setupPopOvers: function($popoverAnchor, id, title, description) {
                var selector = ".description[data-title='" + id + "']",
                    options = {
                        title: title,
                        content: description,
                        trigger: 'hover'
                    };
                $popoverAnchor.find(selector).popover(options);
            }
    };

    return Utils;
});
