/*!
* node-datatable
* https://github.com/jpravetz/node-datatable
* Copyright(c) 2012-2013 Jim Pravetz <jpravetz@epdoc.com>
* node-datatable may be freely distributed under the MIT license.
*/
import { Injectable } from '@nestjs/common';
import _u from 'lodash';
let DEFAULT_LIMIT = 100;

/**
 * Constructor
 * @param options Refer to README.md for a list of properties
 * @return {Object}
 */
@Injectable()
export class QueryBuilder {
	self: any;
	constructor(options: any) {
		this.self = {
			sTableName: options.sTableName,
			sCountColumnName: options.sCountColumnName,		// Name of column to use when counting total number of rows. Defaults to "id"
			sDatabaseOrSchema: options.sDatabaseOrSchema,	// Add a "USE" statement for MySQL / Postgres or "ALTER SESSION SET CURRENT_SCHEMA" statement for Oracle.
			aSearchColumns: options.aSearchColumns || [],	// Used to determine names of columns to search
			sSelectSql: options.sSelectSql,					// alternate select statement
			sFromSql: options.sFromSql,						// alternate select statement
			sWhereAndSql: options.sWhereAndSql,				// Custom caller SQL, added as AND where to add date range or other checks (caller must write the SQL)
			sDateColumnName: options.sDateColumnName,		// If set then only get entries within the range (can use sWhereSql instead)
			dateFrom: options.dateFrom,						// Only retrieve content from before this date. sDateColumnName must be set.
			dateTo: options.dateTo,							// Only retrieve content from after this date. sDateColumnName must be set.
			oRequestQuery: options.oRequestQuery,			// Usually passed in with buildQuery
			sAjaxDataProp: 'data',							// The name of the data prop to set on the return value
			dbType: options.dbType,							// "postgres" or "oracle", defaults to MySQL syntax
			buildQuery: this.buildQuery,
			parseResponse: this.parseResponse,
			extractResponseVal: this.extractResponseVal,
			filteredResult: this.filteredResult,
			sanitize: this.sanitize
		};
	}

	/**
	 * (private) Build an optional "USE sDatabaseOrSchema" for MySQL / Postgres or
	 * "ALTER SESSION SET CURRENT_SCHEMA = sDatabaseOrSchema" statement for Oracle if sDatabaseOrSchema is set.
	 * @return {string|undefined} The SQL statement or undefined
	 */
	buildSetDatabaseOrSchemaStatement(): any {
		if (this.self.sDatabaseOrSchema){
			if (this.self.dbType === 'oracle'){
				return 'ALTER SESSION SET CURRENT_SCHEMA = ' + this.self.sDatabaseOrSchema;
			} else{
				return "USE " + this.self.sDatabaseOrSchema;
			}
		}
		return undefined;
	}

	/**
	 * (private) Build the date partial that is used in a WHERE clause
	 * @return {*}
	 */
	buildDatePartial(): any {
		if (this.self.sDateColumnName && this.self.dateFrom || this.self.dateTo) {
			if (this.self.dateFrom && this.self.dateTo) {
				return this.self.sDateColumnName + " BETWEEN '" + this.self.dateFrom.toISOString() + "' AND '" + this.self.dateTo.toISOString() + "'";
			} else if (this.self.dateFrom) {
				return this.self.sDateColumnName + " >= '" + this.self.dateFrom.toISOString() + "'";
			} else if (this.self.dateTo) {
				return this.self.sDateColumnName + " <= '" + this.self.dateTo.toISOString() + "'";
			}
		}
		return undefined;
	}

	/**
	 * (private) Build a complete SELECT statement that counts the number of entries.
	 * @param searchString If specified then produces a statement to count the filtered list of records.
	 * Otherwise the statement counts the unfiltered list of records.
	 * @return {String} A complete SELECT statement
	 */
	buildCountStatement(requestQuery: any): any {
		let dateSql = this.buildDatePartial();
		let result = "SELECT COUNT(";
		result += this.self.sSelectSql ? this.self.sTableName + ".id" : (this.self.sCountColumnName ? this.self.sCountColumnName : "id");
		result += ") FROM ";
		result += this.self.sFromSql ? this.self.sFromSql : this.self.sTableName;
		result += this.buildWherePartial(requestQuery);
		return result;
	}

	/**
	 * (private) Build the WHERE clause
	 * otherwise uses aoColumnDef mData property.
	 * @param searchString
	 * @return {String}
	 */
	buildWherePartial(requestQuery: any): any {
		let sWheres = [];
		let searchQuery = this.buildSearchPartial(requestQuery);
		if (searchQuery)
			sWheres.push(searchQuery);
		if (this.self.sWhereAndSql)
			sWheres.push(this.self.sWhereAndSql);
		let dateSql = this.buildDatePartial();
		if (dateSql)
			sWheres.push(dateSql);
		if (sWheres.length)
			return " WHERE (" + sWheres.join(") AND (") + ")";
		return "";
	}

	/**
	 * (private)  Builds the search portion of the WHERE clause using LIKE (or ILIKE for PostgreSQL).
	 * @param {Object} requestQuery The datatable parameters that are generated by the client
	 * @return {String} A portion of a WHERE clause that does a search on all searchable row entries.
	 */
	buildSearchPartial(requestQuery: any): any {
		let searches = [],
			colSearches = this.buildSearchArray(requestQuery, false),
			globalSearches = this.buildSearchArray(requestQuery, true);
		if (colSearches.length){
			searches.push('(' + colSearches.join(" AND ") + ')');
		}
		if (globalSearches.length){
			searches.push('(' + globalSearches.join(" OR ") + ')');
		}
		return searches.join(" AND ");
	}

	/**
	 * (private) Builds an array of LIKE / ILIKE statements to be added to the WHERE clause
	 * @param {Object} requestQuery The datatable parameters that are generated by the client
	 * @param {*} [global] If truthy, build a global search array. If falsy, build a column search array
	 * @returns {Array} An array of LIKE / ILIKE statements
	 */
	buildSearchArray(requestQuery: any, global: any): any {
		let searchArray = [],
			customColumns = _u.isArray(this.self.aSearchColumns) && !_u.isEmpty(this.self.aSearchColumns) && global;
		let self = this;
		_u.each(customColumns ? self.self.aSearchColumns : requestQuery.columns, function(column){
			if (customColumns || column.searchable === 'true'){
				let colName = self.sanitize(customColumns ? column : column.name),
					searchVal = self.sanitize(global ? requestQuery.search.value : column.search.value);
				if (colName && searchVal){
					searchArray.push(self.self.dbType === 'postgres' ?
						self.buildILIKESearch(colName, searchVal) :
						self.buildLIKESearch(colName, searchVal));
				}
			}
		});
		return searchArray;
	}

	/**
	 * (private) Builds the search portion of the WHERE clause using ILIKE
	 * @param {string} colName The column to search
	 * @param {string} searchVal The value to search for
	 * @returns {string} An ILIKE statement to be added to the where clause
	 */
	buildILIKESearch(colName: any, searchVal: any): any {
		return "CAST(" + colName + " as text)" + " ILIKE '%" + searchVal + "%'";
	}

	/**
	 * (private) Builds the search portion of the WHERE clause using LIKE
	 * @param {string} colName The column to search
	 * @param {string} searchVal The value to search for
	 * @returns {string} A LIKE statement to be added to the where clause
	 */
	buildLIKESearch(colName: any, searchVal: any): any {
		return colName + " LIKE '%" + searchVal + "%'";
	}

	/**
	 * (private) Adds an ORDER clause
	 * @param requestQuery The Datatable query string (we look at sort direction and sort columns)
	 * @return {String} The ORDER clause
	 */
	buildOrderingPartial(requestQuery: any): any {
		let orderQuery = [requestQuery.order[0]]
		let query = [];
		let l = _u.isArray(orderQuery) ? orderQuery.length : 0;
		for (let fdx = 0; fdx < l; ++fdx) {
			let order = orderQuery[fdx],
				column = requestQuery.columns[order.column];
			if (column.orderable === 'true' && column.name) {
				query.push(column.name + " " + order.dir);
			}
		}
		if (query.length)
			return " ORDER BY " + query.join(", ");
		return "";
	}

	/**
	 * Build a LIMIT clause
	 * @param requestQuery The Datatable query string (we look at length and start)
	 * @return {String} The LIMIT clause
	 */
	buildLimitPartial(requestQuery: any): any {
		let sLimit = "";
		if (requestQuery && requestQuery.start !== undefined && this.self.dbType !== 'oracle') {
			let start = parseInt(requestQuery.start, 10);
			if (start >= 0) {
				if (requestQuery.length < 0) {
					sLimit = ' ';
				} else {
					let len = parseInt(requestQuery.length, 10);
					sLimit = (this.self.dbType === 'postgres') ? " OFFSET " + String(start) + " LIMIT " : " LIMIT " + String(start) + ", ";
					sLimit += ( len > 0 ) ? String(len) : String(DEFAULT_LIMIT);
				}
			}
		}
		return sLimit;
	}

	/**
	 * Build the base SELECT statement.
	 * @return {String} The SELECT partial
	 */
	buildSelectPartial(): any {
		let query = "SELECT ";
		query += this.self.sSelectSql ? this.self.sSelectSql : "*";
		query += " FROM ";
		query += this.self.sFromSql ? this.self.sFromSql : this.self.sTableName;
		return query;
	}

	/**
	 * Build an array of query strings based on the Datatable parameters
	 * @param requestQuery The datatable parameters that are generated by the client
	 * @return {Object} An array of query strings, each including a terminating semicolon.
	 */
	buildQuery(requestQuery: any): any {
		let queries = { changeDatabaseOrSchema: null, recordsTotal: null, recordsFiltered: null, select: null };
		if (typeof requestQuery !== 'object')
			return queries;
		let searchString = this.sanitize(_u.isObject(requestQuery.search) ? requestQuery.search.value : '');
		this.self.oRequestQuery = requestQuery;
		let useStmt = this.buildSetDatabaseOrSchemaStatement();
		if (useStmt) {
			queries.changeDatabaseOrSchema = useStmt;
		}
		queries.recordsTotal = this.buildCountStatement(requestQuery);
		if (searchString) {
			queries.recordsFiltered = this.buildCountStatement(requestQuery);
		}
		let query = this.buildSelectPartial();
		query += this.buildWherePartial(requestQuery);
		query += this.buildOrderingPartial(requestQuery);
		query += this.buildLimitPartial(requestQuery);
		if (this.self.dbType === 'oracle'){
			let start = parseInt(requestQuery.start, 10);
			let len = parseInt(requestQuery.length, 10);
			if (len >= 0 && start >= 0) {
				query = 'SELECT * FROM (SELECT a.*, ROWNUM rnum FROM (' + query + ') ';
				query += 'a)' + ' WHERE rnum BETWEEN ' + (start + 1) + ' AND ' + (start + len);
			}
		}
		queries.select = query;
		return queries;
	}

	/**
	 * Parse the responses from the database and build a Datatable response object.
	 * @param queryResult An array of SQL response objects, each of which must, in order, correspond with a query string
	 * returned by buildQuery.
	 * @return {Object} A Datatable reply that is suitable for sending in a response to the client.
	 */
	parseResponse(queryResult: any): any {
		let _queryResult = { recordsFiltered: 0, recordsTotal: 0, select: null };
		let oQuery = this.self.oRequestQuery;
		let result = { recordsFiltered: 0, recordsTotal: 0, draw: 0, data: null };
		if (oQuery && typeof oQuery.draw === 'string') {
			// Cast for security reasons, as per http://datatables.net/usage/server-side
			result.draw = parseInt(oQuery.draw,10);
		} else {
			result.draw = 0;
		}
		if (_u.isObject(queryResult) && _u.keys(queryResult).length > 1) {
			result.recordsFiltered = result.recordsTotal = this.extractResponseVal(_queryResult.recordsTotal) || 0;
			if (_queryResult.recordsFiltered) {
				result.recordsFiltered = this.extractResponseVal(_queryResult.recordsFiltered) || 0;
			}
			result.data = _queryResult.select;
		}
		return result;
	}

	/**
	 * (private) Extract the value from a database response
	 * @param {Array} res A database response array
	 * @return {*}
	 */
	extractResponseVal(res: any): any {
		if (_u.isArray(res) && res.length && _u.isObject(res[0])) {
			let resObj = _u.values(res[0]);
			if (resObj.length) {
				return resObj[0];
			}
		}
	}

	/**
	 * Debug, reduced size object for display
	 * @param obj
	 * @return {*}
	 */
	filteredResult(obj: any, count: any): any {
		if (obj) {
			let result: any = {};
			result = _u.omit(obj, this.self.sAjaxDataProp );
			result.aaLength = obj[this.self.sAjaxDataProp] ? obj[this.self.sAjaxDataProp].length : 0;
			result[this.self.sAjaxDataProp] = [];
			let counts = count ? Math.min(count, result.aaLength) : result.aaLength;
			for (let idx = 0; idx < counts; ++idx) {
				result[this.self.sAjaxDataProp].push(obj[this.self.sAjaxDataProp][idx]);
			}
			return result;
		}
		return null;
	}
	
	/**
	 * Sanitize to prevent SQL injections.
	 * @param str
	 * @return {*}
	 */
	sanitize(str: any, len?: any): any {
		len = len || 256;
		if (!str || typeof str === 'string' && str.length < 1)
			return str;
		if (typeof str !== 'string' || str.length > len)
			return null;
		return str.replace(/[\0\x08\x09\x1a\n\r"'\\\%]/g, function (char) {
			switch (char) {
				case "\0":
					return "\\0";
				case "\x08":
					return "\\b";
				case "\x09":
					return "\\t";
				case "\x1a":
					return "\\z";
				case "\n":
					return "\\n";
				case "\r":
					return "\\r";
				case "\"":
				case "'":
				case "\\":
				case "%":
					return "\\" + char; // prepends a backslash to backslash, percent,
				// and double/single quotes
			}
		});
	}
}
