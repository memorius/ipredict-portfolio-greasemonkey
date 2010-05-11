// ==UserScript==
// @name           iPredict-portfolio-improved-active-orders
// @namespace      http://github.com/memorius/ipredict-portfolio-greasemonkey
// @description    iPredict (My Portfolio): show active order info per holding and holdings per order
// @include        https://www.ipredict.co.nz/Main.php?do=portfolio*
// @include        https://www.ipredict.co.nz/Main.php?do=edit_order*
// ==/UserScript==

/* This script customizes iPredict's My Portfolio page to add extra columns
   correlating the current stock holdings with active orders and watchlist,
   and to add a persistent 'Notes' field for each portfolio line.
   It works purely on the information already on the page
   - it doesn't make any requests to the server.
   The 'Notes' text is persisted in the local browser user profile,
   using DOM Storage, so it is retained on coming back to the site later.

   It is for use as a userscript with Firefox and the Greasemonkey plugin:
   https://addons.mozilla.org/en-US/firefox/addon/748

   Tested with Firefox 3.0.14 (Linux) and Greasemonkey 0.8.20090920.2

   The script has the following limitations:
     - It will probably break if iPredict changes the page layout
     - Notes fields mess with the table alignment and show scrollbars,
       since there isn't really enough horizontal space for them.

   Author: Nick Clarke - memorius@gmail.com - http://planproof-fool.blogspot.com/
*/

/* This program is free software. It comes without any warranty, to
 * the extent permitted by applicable law. You can redistribute it
 * and/or modify it under the terms of the Do What The Fuck You Want
 * To Public License, Version 2, as published by Sam Hocevar. See
 * http://sam.zoy.org/wtfpl/COPYING for more details. */


/* Allow script to be used on the return to My Portfolio after the last step of editing an order:
   this returns to the My Portfolio page, but it's shown with the 'edit_order' URL the first time.
   So we have to @include the edit_order URL, but exclude the other steps before the return to
   My Portfolio: they have different page title. */
if (!document.title.match("My Portfolio")) {
    return;
}

function findTable(id) {
   // <div id="" class="page-sub-section">
   //    <h4 id="long-stock">...
   //    <table class="full-details-data">...
   // </div>
   /* This only works from Greasemonkey if I use wrappedJSObject: see here:
      http://www.oreillynet.com/pub/a/network/2005/11/01/avoid-common-greasemonkey-pitfalls.html?page=5
      DON'T use this code elsewhere unless you have read the above document -
            I think there may be security implications,
            depending on whether you trust the remote site. */
    return document.wrappedJSObject.getElementById(id).getParent()
            .getElementsByClassName("full-details-data")[0];
}

function getHeaderRow(table) {
    return table.getElement("thead").getElement("tr");
}

function getBodyRows(table) {
    return table.getElement("tbody").getElementsByTagName("tr");
}

function getStockName(tr) {
    // <tr><td><a class="symbol">Name</a> - only one per row
    var a = tr.getElementsByClassName("symbol")[0];
    if (a) {
        return a.textContent;
    } else {
        return null; // last row of some tables
    }
}

function getColumn(tr, column) {
    return tr.getElements("td")[column];
}

function getColumnText(tr, column) {
    // <tr><td>0</td><td>1</td>
    return getColumn(tr, column).textContent;
}

function getStockQuantity(tr, column) {
    return parseInt(getColumnText(tr, column), 10);
}

function getStockPrice(tr, column) {
    // <tr>...<td><span class="price">1</span></td> - index the td because there are several price columns
    var price = getColumn(tr, column).getElementsByClassName("price")[0].textContent;
    return parseFloat(price.replace("$", ""));
}

function addHeaderColumn(table, columnIndex, text, className, colSpan) {
    var thead = getHeaderRow(table);
    var th = document.createElement("th");
    th.appendChild(document.createTextNode(text));
    th.className = className;
    if (colSpan) {
        th.colSpan = colSpan;
    }
    thead.insertBefore(th, thead.getChildren()[columnIndex]);
}

function addTD(tr, columnIndex, text, className) {
    var td = document.createElement("td");
    if (text !== null) {
        td.appendChild(document.createTextNode("" + text));
    }
    td.className = className;
    tr.insertBefore(td, tr.getChildren()[columnIndex]);
    return td;
}

function colorQtyColumn(tr, columnIndex, qty) {
    var className = qtyClass((qty === undefined) ? getStockQuantity(tr, columnIndex) : qty);
    getColumn(tr, columnIndex).className += " " + className;
}

function colorActiveOrdersColumns(tr, typeColumnIndex, qtyColumnIndex, holdings) {
    var typeColumn = getColumn(tr, typeColumnIndex);
    var sign = (typeColumn.textContent === "Sell") ? -1 : 1;
    // Type
    colorQtyColumn(tr, typeColumnIndex, sign);
    // Stock qty
    colorQtyColumn(tr, qtyColumnIndex, sign);
    var heldQty = holdings[stockName] && holdings[stockName].qty;
    var orderStyles = getCustomOrderStyles(sign * getStockQuantity(tr, qtyColumnIndex), heldQty);
    if (orderStyles.length > 0) {
        getColumn(tr, qtyColumnIndex).className += " " + orderStyles.join(" ");
    }
}

function getCustomOrderStyles(orderQty, heldQty) {
    var styles = [];
    styles.push(qtyClass(orderQty));
    // Bold if this order is one that will increase the portfolio
    // (i.e. one which is not in the opposite direction to an existing holding)
    if (!heldQty
            || ((heldQty > 0) == (orderQty > 0))) {
        styles.push("custom-orders-increase-portfolio");
    }
    // Underline if there is an existing holding, and this order will reduce it,
    // but the quantity is different (hence order probably needs editing)
    else if (heldQty
             && ((heldQty > 0) != (orderQty > 0))
             && (Math.abs(heldQty) != Math.abs(orderQty))) {
        styles.push("custom-orders-highlighted");
    }
    return styles;
}

function addOrdersColumn(tr, columnIndex, stockName, orders, holdings) {
    var orderQty = orders[stockName];
    var styles = ["align-right"];
    if (orderQty) {
        var heldQty = holdings[stockName] && holdings[stockName].qty;
        styles = styles.concat(getCustomOrderStyles(orderQty, heldQty));
    }
    addTD(tr, columnIndex, orderQty || null, styles.join(" "));
}

function addHoldingsColumn(tr, columnIndex, stockName, holdings, type) {
    var holding = holdings[stockName];
    var qty = null;
    if (holding
            && (  (type === "Long" && holding.qty > 0)
               || (type === "Short" && holding.qty < 0))) {
        qty = holding.qty;
    }
    addTD(tr, columnIndex, qty, "align-right " + qtyClass(qty));
}

function addHoldingsAverageCostColumn(tr, columnIndex, stockName, holdings) {
    var holding = holdings[stockName];
    addTD(tr, columnIndex, holding ? holding.avgCost : null, "align-center custom-holdings-price");
}

function qtyClass(qty) {
    if (qty === null) {
        return "";
    }
    return (qty > 0) ? "positive" : "negative";
}

function makeNoteKey(stockName, type) {
    return "portfolioCustomization:" + stockName + ":" + type;
}

function getDOMStorage() {
    return window.wrappedJSObject.globalStorage[window.location.hostname];
}

/* storeNote/getNote use DOM storage object for this domain - provides local persistent data storage.
   This only works from Greasemonkey if I use wrappedJSObject: see here:
      http://www.oreillynet.com/pub/a/network/2005/11/01/avoid-common-greasemonkey-pitfalls.html?page=5
      DON'T use this code elsewhere unless you have read the above document -
            I think there may be security implications,
            depending on whether you trust the remote site. */
function storeNote(noteKey, noteText) {
    if (noteText === null || noteText === "") {
        getDOMStorage().removeItem(noteKey);
    } else {
        getDOMStorage().setItem(noteKey, noteText);
    }
}

function getNote(noteKey) {
    var noteText = getDOMStorage().getItem(noteKey);
    return (noteText === undefined || noteText === null) ? "" : noteText;
}

function removeUnusedNotes(noteKeysPresentOnScreen) {
    // Must not remove while iterating because removal can change the order of the keys (hence their indexes)
    var toRemove = [];
    var storage = getDOMStorage();
    var i, noteKey;
    for (i = 0; i < storage.length; i++) {
        noteKey = storage.key(i);
        if (!noteKeysPresentOnScreen[noteKey]) {
            toRemove.push(noteKey);
        }
    }
    for (i = 0; i < toRemove.length; i++) {
        noteKey = toRemove[i];
        storage.removeItem(noteKey);
    }
}

function getNoteTeaser(noteText) {
    // Take first few chars, or stop at end of first line if less. Show '>' if empty.
    var firstFewChars = (noteText + "").match(/^\s*(.{0,15})/)[1];
    return (firstFewChars === "") ? ">" : firstFewChars;
}

function addNotesColumn(tr, columnIndex, noteKey) {
    var className = "align-left custom-notes";
    var noteText = getNote(noteKey);
    var notesTD = addTD(tr, columnIndex, null, className);

    var teaserDiv = notesTD.appendChild(document.createElement("div"));
    teaserDiv.appendChild(document.createTextNode(getNoteTeaser(noteText)));

    var textArea = document.createElement("textarea");
    textArea.value = noteText;
    textArea.className = className;
    textArea.style.display = "none"; // Initially hidden
    notesTD.appendChild(textArea);

    var saveNote = function() {
        storeNote(noteKey, textArea.wrappedJSObject.value);
    };
    var toggleNote = function() {
        var showTextArea = (textArea.style.display === "none");
        if (showTextArea) {
            teaserDiv.textContent = "<";
            textArea.style.display = "";
            textArea.focus();
        } else {
            teaserDiv.textContent = getNoteTeaser(textArea.wrappedJSObject.value);
            textArea.style.display = "none";
        }
    };
    textArea.wrappedJSObject.onblur = saveNote;
    textArea.wrappedJSObject.onkeydown = function(e) {
        // Close on pressing Escape
        if (e.keyCode === 27) {
            saveNote();
            toggleNote();
        }
    };
    teaserDiv.wrappedJSObject.onclick = toggleNote;
}

try {
    // Inject extra styles we will use for the new columns
    var style = document.createElement("style");
    style.type = "text/css";
    style.innerHTML = [
             "td.custom-orders-increase-portfolio {",
             "    font-weight: bold;",
             "}",
             "td.custom-orders-highlighted {",
             "    text-decoration: underline;",
             "}",
             "td.custom-holdings-price {",
             "    color: #0061E4;",
             // "    color: #AAAA00;",
             "}",
             "td.custom-notes {",
             "    padding: 0px !important;",
             "}",
             "textarea.custom-notes {",
             "    height: 100px !important;",
             "    width: 200px !important;",
             "    margin: 0px !important;",
             "    margin-left: 0px !important;",
             "}"
         ].join("\n");
    document.getElementsByTagName('head')[0].appendChild(style);

    // Get the tables we are going to read data from and add columns to
    var activeOrdersTable  = findTable("active-orders");
    var stockIOwnTable     = findTable("long-stock");
    var shortedStockTable  = findTable("short-stock");
    var watchListTable     = findTable("watch-list");

    var activeOrdersBodyRows = getBodyRows(activeOrdersTable);
    var stockIOwnBodyRows    = getBodyRows(stockIOwnTable);
    var shortedStockBodyRows = getBodyRows(shortedStockTable);
    var watchListBodyRows    = getBodyRows(watchListTable);

    var holdings    = [];
    var activeSellOrders = [];
    var activeBuyOrders = [];

    var i, stockName, qty, avgCost, tr;

    // Get long positions by stock name
    for (i = 0; i < stockIOwnBodyRows.length; i++) {
        tr = stockIOwnBodyRows[i];
        stockName = getStockName(tr);
        if (stockName !== null) {
            qty = getStockQuantity(tr, 1);
            avgCost = getStockPrice(tr, 2);
            holdings[stockName] = { qty: qty, avgCost: avgCost };
            // alert(stockName + ":" + holdings[stockName].qty + "/" + holdings[stockName].avgCost);
        }
    }

    // Get short positions by stock name
    for (i = 0; i < shortedStockBodyRows.length; i++) {
        tr = shortedStockBodyRows[i];
        stockName = getStockName(tr);
        if (stockName !== null) {
            qty = getStockQuantity(tr, 1);
            avgCost = getStockPrice(tr, 2);
            holdings[stockName] = { qty: qty, avgCost: avgCost };
            // alert(stockName + ":" + holdings[stockName].qty + "/" + holdings[stockName].avgCost);
        }
    }

    // Get buy/sell order quantities by stock name
    // Note this is incomplete if Active Orders is broken over multiple pages
    // - still somewhat useful because the lists are sorted.
    for (i = 0; i < activeOrdersBodyRows.length; i++) {
        tr = activeOrdersBodyRows[i];
        stockName = getStockName(tr);
        if (stockName !== null) {
            qty = getStockQuantity(tr, 2);
            if (getColumnText(tr, 1) === "Sell") {
                if (!activeSellOrders[stockName]) {
                    activeSellOrders[stockName] = 0;
                }
                activeSellOrders[stockName] -= qty;
            } else {
                if (!activeBuyOrders[stockName]) {
                    activeBuyOrders[stockName] = 0;
                }
                activeBuyOrders[stockName] += qty;
            }
        }
    }

    // Add columns to the Stock I Own table showing orders
    addHeaderColumn(stockIOwnTable, 1, "Buy",  "align-right");
    addHeaderColumn(stockIOwnTable, 2, "Sell", "align-right");
    addHeaderColumn(stockIOwnTable, 10, "Notes", "align-left", 2);
    var noteKey;
    var noteKeysPresentOnScreen = [];
    for (i = 0; i < stockIOwnBodyRows.length; i++) {
        tr = stockIOwnBodyRows[i];
        stockName = getStockName(tr);
        if (stockName !== null) {
            noteKey = makeNoteKey(stockName, "long");
            noteKeysPresentOnScreen[noteKey] = true;
            colorQtyColumn(tr, 1);
            addOrdersColumn(tr, 1, stockName, activeBuyOrders, holdings);
            addOrdersColumn(tr, 2, stockName, activeSellOrders, holdings);
            addNotesColumn(tr, 10, noteKey);
        }
    }

    // Add columns to the Shorted Stock table showing orders
    addHeaderColumn(shortedStockTable, 1, "Buy",  "align-right");
    addHeaderColumn(shortedStockTable, 2, "Sell", "align-right");
    addHeaderColumn(shortedStockTable, 10, "Notes", "align-left", 2);
    for (i = 0; i < shortedStockBodyRows.length; i++) {
        tr = shortedStockBodyRows[i];
        stockName = getStockName(tr);
        if (stockName !== null) {
            noteKey = makeNoteKey(stockName, "short");
            noteKeysPresentOnScreen[noteKey] = true;
            colorQtyColumn(tr, 1);
            addOrdersColumn(tr, 1, stockName, activeBuyOrders, holdings);
            addOrdersColumn(tr, 2, stockName, activeSellOrders, holdings);
            addNotesColumn(tr, 10, noteKey);
        }
    }

    // Add columns to the Active Orders table showing holdings
    addHeaderColumn(activeOrdersTable, 1, "Long",      "align-right");
    addHeaderColumn(activeOrdersTable, 2, "Short",     "align-right");
    addHeaderColumn(activeOrdersTable, 3, "Avg. Cost", "align-center");
    addHeaderColumn(activeOrdersTable, 11, "Notes",    "align-left", 2);
    for (i = 0; i < activeOrdersBodyRows.length; i++) {
        tr = activeOrdersBodyRows[i];
        stockName = getStockName(tr);
        if (stockName !== null) {
            noteKey = makeNoteKey(stockName, "orders");
            noteKeysPresentOnScreen[noteKey] = true;
            colorActiveOrdersColumns(tr, 1, 2, holdings);
            addHoldingsColumn(tr, 1, stockName, holdings, "Long");
            addHoldingsColumn(tr, 2, stockName, holdings, "Short");
            addHoldingsAverageCostColumn(tr, 3, stockName, holdings);
            addNotesColumn(tr, 11, noteKey);
        }
    }

    // Add columns to the Watch List table showing holdings and orders
    addHeaderColumn(watchListTable, 1, "Long",      "align-right");
    addHeaderColumn(watchListTable, 2, "Short",     "align-right");
    addHeaderColumn(watchListTable, 3, "Avg. Cost", "align-center");
    addHeaderColumn(watchListTable, 4, "Buy",       "align-right");
    addHeaderColumn(watchListTable, 5, "Sell",      "align-right");
    addHeaderColumn(watchListTable, 10, "Notes",    "align-left", 2);
    for (i = 0; i < watchListBodyRows.length; i++) {
        tr = watchListBodyRows[i];
        stockName = getStockName(tr);
        if (stockName !== null) {
            noteKey = makeNoteKey(stockName, "watch");
            noteKeysPresentOnScreen[noteKey] = true;
            addHoldingsColumn(tr, 1, stockName, holdings, "Long");
            addHoldingsColumn(tr, 2, stockName, holdings, "Short");
            addHoldingsAverageCostColumn(tr, 3, stockName, holdings);
            addOrdersColumn(tr, 4, stockName, activeBuyOrders, holdings);
            addOrdersColumn(tr, 5, stockName, activeSellOrders, holdings);
            addNotesColumn(tr, 10, noteKey);
        }
    }

    // Ensures that old notes (for cleared positions / deleted orders or watches)
    // don't reappear with misleading values if a new position / order or watch
    // is recreated
    removeUnusedNotes(noteKeysPresentOnScreen);

    // alert("OK");
} catch (e) {
    alert("iPredict-portfolio-improved-active-orders failed at: " + e);
}
