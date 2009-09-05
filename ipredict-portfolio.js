// ==UserScript==
// @name           iPredict-portfolio-improved-active-orders
// @namespace      ipredict
// @description    iPredict (My Portfolio): show active order info per holding and holdings per order
// @include        https://www.ipredict.co.nz/Main.php?do=portfolio*
// ==/UserScript==

/* This script customizes iPredict's My Portfolio page to add extra columns
   correlating the current stock holdings with active orders and watchlist.
   It works purely on the information already on the page
   - it doesn't make any requests to the server.

   It is for use as a userscript with Firefox and the Greasemonkey plugin:
   https://addons.mozilla.org/en-US/firefox/addon/748

   Tested with Firefox 3.0.13 (Linux) and Greasemonkey 0.8.20090123.1

   The script has the following limitations:
     - It will probably break if iPredict changes the page layout
     - If there are enough entries in the 'active orders' list that it spans
       multiple pages, then the 'active order' info added to the other tables
       will only show the orders on the current page - the remaining info is
       not available.

   Author: Nick Clarke - memorius@gmail.com - http://planproof-fool.blogspot.com/ */

/* This program is free software. It comes without any warranty, to
 * the extent permitted by applicable law. You can redistribute it
 * and/or modify it under the terms of the Do What The Fuck You Want
 * To Public License, Version 2, as published by Sam Hocevar. See
 * http://sam.zoy.org/wtfpl/COPYING for more details. */


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

function getColumnText(tr, column) {
    // <tr><td>0</td><td>1</td>
    return tr.getElements("td")[column].textContent;
}

function getStockQuantity(tr, column) {
    return parseInt(getColumnText(tr, column), 10);
}

function getStockPrice(tr, column) {
    // <tr>...<td><span class="price">1</span></td> - index the td because there are several price columns
    var price = tr.getElements("td")[column].getElementsByClassName("price")[0].textContent;
    return parseFloat(price.replace("$", ""));
}

function addHeaderColumn(table, columnIndex, text, className) {
    var thead = getHeaderRow(table);
    var th = document.createElement("th");
    th.appendChild(document.createTextNode(text));
    th.className = className;
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

function addOrdersColumn(tr, columnIndex, stockName, orders, holdings) {
    var orderQty = orders[stockName];
    var styles = ["align-right"];
    if (orderQty) {
        styles.push(qtyClass(orderQty));
        // Bold if this order is one that will increase the portfolio
        // (i.e. one which is not in the opposite direction to an existing holding)
        var heldQty = holdings[stockName] && holdings[stockName].qty;
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
    }
    addTD(tr, columnIndex, orderQty || null, styles.join(" "));
}

function addHoldingsColumn(tr, columnIndex, stockName, holdings) {
    var holding = holdings[stockName];
    var qty = holding ? holding.qty : null;
    addTD(tr, columnIndex, qty, "align-right " + qtyClass(qty));
}

function addHoldingsAverageCostColumn(tr, columnIndex, stockName, stockIOwn, shortedStock) {
    var holding = stockIOwn[stockName] || shortedStock[stockName];
    addTD(tr, columnIndex, holding ? holding.avgCost : null, "align-center custom-holdings-price");
}

function qtyClass(qty) {
    if (qty === null) {
        return "";
    }
    return (qty > 0) ? "positive" : "negative";
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

    var stockIOwn    = [];
    var shortedStock = [];
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
            stockIOwn[stockName] = { qty: qty, avgCost: avgCost };
            // alert(stockName + ":" + stockIOwn[stockName].qty + "/" + stockIOwn[stockName].avgCost);
        }
    }

    // Get short positions by stock name
    for (i = 0; i < shortedStockBodyRows.length; i++) {
        tr = shortedStockBodyRows[i];
        stockName = getStockName(tr);
        if (stockName !== null) {
            qty = getStockQuantity(tr, 1);
            avgCost = getStockPrice(tr, 2);
            shortedStock[stockName] = { qty: qty, avgCost: avgCost };
            // alert(stockName + ":" + shortedStock[stockName].qty + "/" + shortedStock[stockName].avgCost);
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
    for (i = 0; i < stockIOwnBodyRows.length; i++) {
        tr = stockIOwnBodyRows[i];
        stockName = getStockName(tr);
        if (stockName !== null) {
            addOrdersColumn(tr, 1, stockName, activeBuyOrders, stockIOwn);
            addOrdersColumn(tr, 2, stockName, activeSellOrders, stockIOwn);
        }
    }

    // Add columns to the Shorted Stock table showing orders
    addHeaderColumn(shortedStockTable, 1, "Buy",  "align-right");
    addHeaderColumn(shortedStockTable, 2, "Sell", "align-right");
    for (i = 0; i < shortedStockBodyRows.length; i++) {
        tr = shortedStockBodyRows[i];
        stockName = getStockName(tr);
        if (stockName !== null) {
            addOrdersColumn(tr, 1, stockName, activeBuyOrders, shortedStock);
            addOrdersColumn(tr, 2, stockName, activeSellOrders, shortedStock);
        }
    }

    // Add columns to the Active Orders table showing holdings
    addHeaderColumn(activeOrdersTable, 1, "Long",      "align-right");
    addHeaderColumn(activeOrdersTable, 2, "Short",     "align-right");
    addHeaderColumn(activeOrdersTable, 3, "Avg. Cost", "align-center");
    for (i = 0; i < activeOrdersBodyRows.length; i++) {
        tr = activeOrdersBodyRows[i];
        stockName = getStockName(tr);
        if (stockName !== null) {
            addHoldingsColumn(tr, 1, stockName, stockIOwn);
            addHoldingsColumn(tr, 2, stockName, shortedStock);
            addHoldingsAverageCostColumn(tr, 3, stockName, stockIOwn, shortedStock);
        }
    }

    // Add columns to the Watch List table showing holdings and orders
    addHeaderColumn(watchListTable, 1, "Long",      "align-right");
    addHeaderColumn(watchListTable, 2, "Short",     "align-right");
    addHeaderColumn(watchListTable, 3, "Avg. Cost", "align-center");
    addHeaderColumn(watchListTable, 4, "Buy",       "align-right");
    addHeaderColumn(watchListTable, 5, "Sell",      "align-right");
    for (i = 0; i < watchListBodyRows.length; i++) {
        tr = watchListBodyRows[i];
        stockName = getStockName(tr);
        if (stockName !== null) {
            addHoldingsColumn(tr, 1, stockName, stockIOwn);
            addHoldingsColumn(tr, 2, stockName, shortedStock);
            addHoldingsAverageCostColumn(tr, 3, stockName, stockIOwn, shortedStock);
            addOrdersColumn(tr, 4, stockName, activeBuyOrders, shortedStock);
            addOrdersColumn(tr, 5, stockName, activeSellOrders, stockIOwn);
        }
    }

    // alert("OK");
} catch (e) {
    alert("iPredict-portfolio-improved-active-orders failed at: " + e);
}
