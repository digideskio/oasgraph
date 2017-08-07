'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _require = require('graphql'),
    GraphQLObjectType = _require.GraphQLObjectType,
    GraphQLString = _require.GraphQLString,
    GraphQLInt = _require.GraphQLInt,
    GraphQLFloat = _require.GraphQLFloat,
    GraphQLBoolean = _require.GraphQLBoolean,
    GraphQLNonNull = _require.GraphQLNonNull,
    GraphQLList = _require.GraphQLList,
    GraphQLInputObjectType = _require.GraphQLInputObjectType,
    GraphQLEnumType = _require.GraphQLEnumType;

var Oas3Tools = require('./oas_3_tools.js');
var ResolverBuilder = require('./resolver_builder.js');
var Preprocessor = require('./preprocessor.js');
var log = require('debug')('translation');
var deepEqual = require('deep-equal');

/**
 * Creates a GraphQL (Input) Type for the given JSON schema.
 *
 * @param  {String}  options.name       Name of the type to create
 *                                        NOTE: ignored for scalar types
 * @param  {object}  options.schema     JSON schema
 * @param  {Object}  options.operation  Operation being translated
 *                                        NOTE: Only used to add sub operations
 * @param  {Hash}    options.links      Links belonging to (Input) Type
 * @param  {Object}  options.data       Data produced by preprocessing
 * @param  {Object}  options.oas        Raw OpenAPI Specification 3.0
 * @param  {Number}  options.iteration  Count of recursions used to create type
 * @param  {Boolean} options.isMutation Whether to create an Input Type
 *
 * @return {GraphQLObjectType|GraphQLInputObjectType|GraphQLList|GraphQLScalar}
 */
var getGraphQLType = function getGraphQLType(_ref) {
  var name = _ref.name,
      schema = _ref.schema,
      _ref$operation = _ref.operation,
      operation = _ref$operation === undefined ? {} : _ref$operation,
      _ref$links = _ref.links,
      links = _ref$links === undefined ? {} : _ref$links,
      data = _ref.data,
      oas = _ref.oas,
      _ref$iteration = _ref.iteration,
      iteration = _ref$iteration === undefined ? 0 : _ref$iteration,
      _ref$isMutation = _ref.isMutation,
      isMutation = _ref$isMutation === undefined ? false : _ref$isMutation;

  // avoid excessive iterations
  if (iteration === 20) {
    throw new Error('Too many iterations when creating schema ' + name);
  }

  // no valid schema name
  if (!name || typeof name !== 'string') {
    throw new Error('Invalid schema name provided');
  }

  // some error checking
  if (!schema || (typeof schema === 'undefined' ? 'undefined' : _typeof(schema)) !== 'object') {
    throw new Error('Invalid schema for ' + name + ' provided of type ' + ('"' + (typeof schema === 'undefined' ? 'undefined' : _typeof(schema)) + '"'));
  }

  // resolve allOf element in schema if applicable
  if ('allOf' in schema) {
    log('resolve allOf in "' + name + '"');
    resolveAllOf(schema.allOf, schema, oas);
    delete schema.allOf;
  }

  // determine the type of the schema
  var type = Oas3Tools.getSchemaType(schema);

  // CASE: no known type
  if (!type) {
    log('Warning: skipped creation of (Input) Type "' + name + '", which has no ' + ('valid schema type. Schema: ' + JSON.stringify(schema)));
    return null;

    // CASE: object - create ObjectType
  } else if (type === 'object') {
    return reuseOrCreateOt({
      name: name,
      schema: schema,
      operation: operation,
      links: links,
      data: data,
      oas: oas,
      iteration: iteration,
      isMutation: isMutation
    });

    // CASE: array - create ArrayType
  } else if (type === 'array') {
    return reuseOrCreateList({
      name: name,
      schema: schema,
      operation: operation,
      links: links,
      data: data,
      oas: oas,
      iteration: iteration,
      isMutation: isMutation
    });

    // CASE: enum - create EnumType
  } else if (type === 'enum') {
    return reuseOrCreateEnum({
      name: name,
      data: data,
      enumList: schema.enum
    });

    // CASE: scalar - return scalar
  } else {
    return getScalarType(type, data);
  }
};

/**
 * Returns an existing (Input) Object Type or creates a new one, and stores it
 * in data
 *
 * A returned GraphQLObjectType has the following internal structure:
 *
 *   new GraphQLObjectType({
 *     name        // optional name of the type
 *     description // optional description of type
 *     fields      // REQUIRED returning fields
 *       type      // REQUIRED definition of the field type
 *       args      // optional definition of types
 *       resolve   // optional function defining how to obtain this type
 *   })
 *
 * @param  {String}  options.name       Name of the schema
 * @param  {Object}  options.operation  Operation being translated
 *                                        NOTE: Only used to add sub operations
 * @param  {Hash}    options.links      Links belonging to (Input) Object Type
 * @param  {Object}  options.data       Data produced by preprocessing
 * @param  {Object}  options.oas        OpenAPI Specification 3.0
 * @param  {Number}  options.iteration  Integer count of recursions used to
 *                                        create this schema
 * @param  {Boolean} options.isMutation Whether to create an Input Object Type
 *
 * @return {GraphQLObjectType|GraphQLInputObjectType}
 */
var reuseOrCreateOt = function reuseOrCreateOt(_ref2) {
  var name = _ref2.name,
      schema = _ref2.schema,
      operation = _ref2.operation,
      links = _ref2.links,
      data = _ref2.data,
      oas = _ref2.oas,
      _ref2$iteration = _ref2.iteration,
      iteration = _ref2$iteration === undefined ? 0 : _ref2$iteration,
      isMutation = _ref2.isMutation;

  // some validation
  if (typeof schema === 'undefined') {
    throw new Error('no schema passed to reuseOrCreateOt for name ' + name);
  }

  // fetch or create data definition
  var def = Preprocessor.createOrReuseDataDef(schema, { fromRef: name }, data);

  // CASE: query - create or reuse OT
  if (!isMutation) {
    if (typeof def.ot !== 'undefined') {
      log('reuse  Object Type "' + def.otName + '"');
      return def.ot;
    } else {
      log('create Object Type "' + def.otName + '"');

      def.ot = new GraphQLObjectType({
        name: def.otName,
        description: schema.description, // might be undefined
        fields: function fields() {
          return createFields({
            schemaName: def.otName,
            schema: schema,
            operation: operation,
            links: links,
            data: data,
            oas: oas,
            iteration: iteration,
            isMutation: isMutation
          });
        }
      });
      return def.ot;
    }
    // CASE: mutation - create or reuse IOT
  } else {
    if (typeof def.iot !== 'undefined') {
      log('reuse  Input Object Type "' + def.iotName + '"');
      return def.iot;
    } else {
      log('create Input Object Type "' + def.iotName + '"');
      def.iot = new GraphQLInputObjectType({
        name: def.iotName,
        description: schema.description, // might be undefined
        fields: function fields() {
          return createFields({
            schemaName: def.iotName,
            schema: schema,
            operation: operation,
            links: links,
            data: data,
            oas: oas,
            iteration: iteration,
            isMutation: isMutation
          });
        }
      });
      return def.iot;
    }
  }
};

/**
 * Returns an existing List or creates a new one, and stores it in data
 *
 * @param  {String}  options.name       Name of the list type
 * @param  {Object}  options.operation  Operation being translated
 *                                        NOTE: Only used to add sub operations
 * @param  {Object}  options.schema     JSON schema describing list
 * @param  {Hash}    options.links      Links belonging to (Input) Type
 * @param  {Object}  options.data       Data produced by preprocessing
 * @param  {Object}  options.oas        Raw OpenAPI Specification 3.0
 * @param  {Number}  options.iteration  Count of recursions used to create type
 * @param  {Boolean} options.isMutation Whether to create an Input Type
 *
 * @return {GraphQLList}
 */
var reuseOrCreateList = function reuseOrCreateList(_ref3) {
  var name = _ref3.name,
      operation = _ref3.operation,
      schema = _ref3.schema,
      links = _ref3.links,
      data = _ref3.data,
      oas = _ref3.oas,
      iteration = _ref3.iteration,
      isMutation = _ref3.isMutation;

  // minimal error-checking
  if (!('items' in schema)) {
    throw new Error('Items property missing in array schema definition of ' + ('' + name));
  }

  var def = Preprocessor.createOrReuseDataDef(schema, { fromRef: name + 'List' }, data);

  // try to reuse existing Object Type
  if (!isMutation && typeof def.ot !== 'undefined') {
    log('reuse  GraphQLList "' + def.otName + '"');
    return def.ot;
  } else if (isMutation && typeof def.iot !== 'undefined') {
    log('reuse  GraphQLList "' + def.iotName + '"');
    return def.iot;
  }

  // create new List Object Type
  log('create GraphQLList "' + def.otName + '"');

  // determine the type of the list elements
  var itemsSchema = schema.items;
  var itemsName = name + 'ListItem';
  if ('$ref' in itemsSchema) {
    itemsSchema = Oas3Tools.resolveRef(itemsSchema['$ref'], oas);
    itemsName = schema.items['$ref'].split('/').pop();
  }

  var itemsType = getGraphQLType({
    name: itemsName,
    schema: itemsSchema,
    data: data,
    operation: operation,
    links: links,
    oas: oas,
    iteration: iteration + 1,
    isMutation: isMutation
  });

  if (itemsType !== null) {
    var listObjectType = new GraphQLList(itemsType);

    // store newly created List Object Type
    if (!isMutation) {
      def.ot = listObjectType;
    } else {
      def.iot = listObjectType;
    }
    return listObjectType;
  } else {
    log('Warning: skipped creation of list \'' + name + '\' because list item \'' + itemsName + '\' has no valid schema. Schema: ' + JSON.stringify(itemsSchema));
    return null;
  }
};

/**
 * Returns an existing Enum Type or creates a new one, and stores it in data
 *
 * @param  {String} options.name     Name of the enum type
 * @param  {Object} options.data     Data produced by preprocessing
 * @param  {Array}  options.enumList List of enum entries
 *
 * @return {GraphQLEnumType}
 */
var reuseOrCreateEnum = function reuseOrCreateEnum(_ref4) {
  var name = _ref4.name,
      data = _ref4.data,
      enumList = _ref4.enumList;

  // try to reuse existing Enum Type
  var def = Preprocessor.createOrReuseDataDef(enumList, { fromRef: name }, data);

  if (typeof def.ot !== 'undefined') {
    log('reuse  GraphQLEnumType "' + def.otName + '"');
    return def.ot;
  } else {
    log('create GraphQLEnumType "' + def.otName + '"');
    var values = {};
    enumList.forEach(function (e) {
      values[Oas3Tools.beautify(e)] = {
        value: e
      };
    });

    // store newly created Enum Object Type
    def.ot = new GraphQLEnumType({
      name: def.otName,
      values: values
    });
    return def.ot;
  }
};

/**
 * Returns the scalar GraphQL type matching the given JSON schema type
 *
 * @param  {String} type   Scalar JSON schema type
 * @param  {Object} data   Data produced by preprocessing
 *
 * @return {GraphQLScalar}
 */
var getScalarType = function getScalarType(type, data) {
  switch (type) {
    case 'string':
      return GraphQLString;
    case 'integer':
      return GraphQLInt;
    case 'number':
      return GraphQLFloat;
    case 'boolean':
      return GraphQLBoolean;
    default:
      if (!data.strict) {
        log('Warning: can\'t resolve type "' + type + '" - default to GraphQLString');
        return GraphQLString;
      } else {
        throw new Error('Unknown JSON scalar "' + type + '"');
      }
  }
};

/**
 * Creates the fields object to be used by an ObjectType
 *
 * @param  {Object}  options.schema     JSON schema to create fields for
 * @param  {Hash}    options.links      Links belonging to (Input) Object Type
 * @param  {Object}  options.operation  Operation being translated
 * @param  {Object}  options.oas        Raw OpenAPI Specification 3.0
 * @param  {Object}  options.data       Data produced by preprocessing
 * @param  {Number}  options.iteration  Count of recursions used to create type
 * @param  {Boolean} options.isMutation Whether to create an Input Object Type
 *
 * @return {Object}                     Object containing fields
 */
var createFields = function createFields(_ref5) {
  var schemaName = _ref5.schemaName,
      schema = _ref5.schema,
      operation = _ref5.operation,
      links = _ref5.links,
      data = _ref5.data,
      oas = _ref5.oas,
      iteration = _ref5.iteration,
      isMutation = _ref5.isMutation;

  var fields = {};

  // resolve reference if applicable
  if ('$ref' in schema) {
    schema = Oas3Tools.resolveRef(schema['$ref'], oas);
  }

  // create fields for properties
  for (var propertyKey in schema.properties) {
    var propSchema = schema.properties[propertyKey];
    var propSchemaName = propertyKey; // name of schema for this prop's field

    // determine if this property is required in mutations
    var reqMutationProp = isMutation && 'required' in schema && schema.required.includes(propertyKey);

    // if properties are referenced, try to reuse schemas
    if ('$ref' in propSchema) {
      propSchemaName = propSchema['$ref'].split('/').pop();
      propSchema = Oas3Tools.resolveRef(propSchema['$ref'], oas);
    }

    // get object type describing the property
    var objectType = getGraphQLType({
      name: propSchemaName,
      schema: propSchema,
      operation: operation,
      links: links,
      data: data,
      oas: oas,
      iteration: iteration + 1,
      isMutation: isMutation
    });

    // finally, add the object type to the fields (using sanitized field name)
    if (objectType) {
      var sanePropName = Oas3Tools.beautifyAndStore(propertyKey, data.saneMap);
      fields[sanePropName] = {
        type: reqMutationProp ? new GraphQLNonNull(objectType) : objectType,
        description: propSchema.description // might be undefined
      };
    }
  }

  // create fields for links
  if (iteration === 0) {
    var _loop = function _loop(linkKey) {
      log('create link "' + linkKey + '"...');

      // get linked operation
      var linkedOpId = void 0;
      // TODO: href is yet another alternative to operationRef and operationId
      if ('operationId' in links[linkKey]) {
        linkedOpId = links[linkKey].operationId;
      } else {
        throw new Error('Link definition has neither "operationRef",\n          "operationId", or "hRef" property');
      }
      var linkedOp = data.operations[linkedOpId];

      // determine parameters provided via link
      var argsFromLink = links[linkKey].parameters;

      // remove argsFromLinks from operation parameters
      var endpointParameters = linkedOp.parameters;
      var dynamicParams = endpointParameters.filter(function (p) {
        return !(p.name in argsFromLink);
      });

      // get resolve function for link
      var linkResolver = ResolverBuilder.getResolver({
        operation: linkedOp,
        argsFromLink: argsFromLink,
        data: data,
        oas: oas
      });

      // get args for link
      var args = getArgs({
        parameters: dynamicParams,
        data: data,
        oas: oas
      });

      /**
       * get response object type
       * use the reference here
       * OT will be built up some other time
       */
      var resObjectType = linkedOp.resDef.ot;

      // finally, add the object type to the fields (using sanitized field name)
      var saneLinkKey = Oas3Tools.beautifyAndStore(linkKey, data.saneMap);
      fields[saneLinkKey] = {
        type: resObjectType,
        resolve: linkResolver,
        args: args,
        description: links[linkKey].description // may be undefined
      };
    };

    for (var linkKey in links) {
      _loop(linkKey);
    }
  }

  // create fields for subOperations
  if (iteration === 0) {
    var _loop2 = function _loop2(operationIndex) {
      var subOp = operation.subOps[operationIndex];
      var fieldName = subOp.resDef.otName;
      if (typeof fields[fieldName] !== 'undefined') {
        log('Warning: cannot add sub operation "' + fieldName + '" to ' + ('"' + operation.resDef.otName + '". Collision detected.'));
        return 'continue';
      }

      log('add sub operation "' + fieldName + '" to ' + ('"' + operation.resDef.otName + '"'));

      // determine parameters provided via parent operation
      var argsFromParent = operation.parameters.filter(function (param) {
        return param.in === 'path';
      }).map(function (args) {
        return args.name;
      });

      var subOpResolver = ResolverBuilder.getResolver({
        operation: subOp,
        argsFromParent: argsFromParent,
        data: data,
        oas: oas
      });

      var dynamicParams = subOp.parameters.filter(function (parameter) {
        return !argsFromParent.includes(parameter.name);
      });

      // get args
      var args = getArgs({
        parameters: dynamicParams,
        oas: oas,
        data: data
      });

      fields[fieldName] = {
        type: subOp.resDef.ot,
        resolve: subOpResolver,
        args: args,
        description: subOp.resDef.schema.description
      };
    };

    for (var operationIndex in operation.subOps) {
      var _ret2 = _loop2(operationIndex);

      if (_ret2 === 'continue') continue;
    }
  }
  return fields;
};

/**
 * Creates an object with the arguments for resolving a GraphQL (Input) Object
 * Type
 *
 * @param  {Array}   options.parameters        List of OAS parameters
 * @param  {Object}  options.reqSchema         JSON schema of request
 * @param  {String}  options.reqSchemaName     Name of request payload schema
 * @param  {Boolean} options.reqSchemaRequired Whether the request schema is required
 * @param  {Object}  options.data
 * @param  {Object}  options.oas
 * @param  {Object}  options.operation         Operation being translated
 *
 * @return {Object}                            Key: name of argument,
 *                                               value: object stating the parameter type
 */
var getArgs = function getArgs(_ref6) {
  var parameters = _ref6.parameters,
      reqSchema = _ref6.reqSchema,
      reqSchemaName = _ref6.reqSchemaName,
      _ref6$reqRequired = _ref6.reqRequired,
      reqRequired = _ref6$reqRequired === undefined ? false : _ref6$reqRequired,
      data = _ref6.data,
      oas = _ref6.oas,
      operation = _ref6.operation;

  var args = {};

  // handle params
  for (var parameterIndex in parameters) {
    var parameter = parameters[parameterIndex];

    // we need at least a name
    if (typeof parameter.name !== 'string') {
      log('Warning: ignore parameter with no "name" property: ' + parameter);
      continue;
    }

    // if this parameter is provided via options, ignore
    if (_typeof(data.options) === 'object') {
      if (_typeof(data.options.headers) === 'object' && parameter.name in data.options.headers) {
        continue;
      }
      if (_typeof(data.options.qs) === 'object' && parameter.name in data.options.qs) {
        continue;
      }
    }

    // determine type of parameter (often, there is none - assume string)
    var type = GraphQLString;
    if ('schema' in parameter && 'type' in parameter.schema && !(parameter.schema.type === 'object' || parameter.schema.type === 'array')) {
      type = getScalarType(parameter.schema.type);
    }

    // sanitize the argument name
    // NOTE: when matching these parameters back to requests, we need to again
    // use the real parameter name
    var saneName = Oas3Tools.beautify(parameter.name);

    args[saneName] = {
      type: parameter.required ? new GraphQLNonNull(type) : type,
      description: parameter.description // might be undefined
    };
  }

  // handle reqBodySchema
  if (typeof reqSchemaName === 'string') {
    var reqObjectType = getGraphQLType({
      name: reqSchemaName,
      schema: reqSchema,
      data: data,
      operation: operation,
      oas: oas,
      isMutation: true
    });

    if (reqObjectType) {
      // sanitize the argument name
      var _saneName = Oas3Tools.beautify(reqSchemaName);
      args[_saneName] = {
        type: reqRequired ? new GraphQLNonNull(reqObjectType) : reqObjectType,
        description: reqSchema.description // might be undefined
      };
    }
  }
  return args;
};

/**
 * Aggregates the subschemas in the allOf field into the mother schema
 * Please note that the allOfSchema may not necessarily be an element of the
 * mother schema. The purpose of this construction is to resolve nested allOf
 * schemas inside references.
 *
 * @param  {Object} allOfSchema allOf schema
 * @param  {Object} schema      Mother schema
 * @param  {Object} oas         Scalar JSON schema type
 */
var resolveAllOf = function resolveAllOf(allOfSchema, schema, oas) {
  var _loop3 = function _loop3(allOfSchemaIndex) {
    var subschema = allOfSchema[allOfSchemaIndex];

    // resolve the reference is applicable
    if ('$ref' in subschema) {
      subschema = Oas3Tools.resolveRef(subschema.$ref, oas);
    }

    // iterate through all the subschema keys
    Object.keys(subschema).forEach(function (subschemaKey) {
      switch (subschemaKey) {
        case 'type':
          // TODO: strict?
          if (typeof schema.type === 'string' && subschema.type !== subschema.type) {
            /**
             * if the schema is an object type but does not contain a properties
             * field, than we can overwrite the type because a schema with
             * an object tye and no properties field is equivalent to an empty
             * schema
             */
            if (schema.type === 'object' && !('properties' in schema)) {
              schema.type = subschema.type;
            } else {
              throw new Error('allOf will overwrite a preexisting type definition' + ('\'type: ' + schema.type + '\' with \'type: ' + subschema.type + '\' in schema \'' + JSON.stringify(schema) + '\''));
            }
          } else {
            schema.type = subschema.type;
          }
          break;

        case 'properties':
          // imply type object from properties field
          if (!(typeof schema.type === 'string')) {
            schema.type = 'object';
            // cannot replace an object type with a scalar or array type
          } else if (schema.type !== 'object') {
            throw new Error('allOf will overwrite a preexisting type definition' + ('\'type: ' + schema.type + '\' with \'type: object\' in schema \'' + JSON.stringify(schema) + '\''));
          }

          var properties = subschema.properties;

          var propertyNames = Object.keys(properties);

          if (!('properties' in schema)) {
            schema.properties = {};
          }

          for (var propertyNameIndex in propertyNames) {
            var propertyName = propertyNames[propertyNameIndex];

            if (!(propertyName in schema.properties)) {
              schema.properties[propertyName] = properties[propertyName];

              // check if the preexisting schema is the same
            } else if (deepEqual(schema.properties[propertyName], subschema.properties[propertyName])) {
              throw new Error('allOf will overwrite a preexisting property ' + ('\'' + propertyName + ': ' + JSON.stringify(schema.properties[propertyName]) + '\' ') + ('with \'' + propertyName + ': ' + JSON.stringify(subschema.properties[propertyName]) + '\' ') + ('in schema \'' + JSON.stringify(schema)));
            }
          }
          break;

        case 'items':
          // imply type array from items field
          if (!(typeof schema.type === 'string')) {
            schema.type = 'array';
            // cannot replace an array type with a scalar or object type
          } else if (schema.type !== 'array') {
            throw new Error('allOf will overwrite a preexisting type definition' + ('\'type: ' + schema.type + '\' with \'type: array\' in schema \'' + JSON.stringify(schema) + '\''));
          }
          if (!('items' in schema)) {
            schema.items = {};
          }

          for (var itemIndex in subschema.items) {
            schema.items = subschema.items[itemIndex];
          }
          break;

        case 'allOf':
          resolveAllOf(subschema.allOf, schema, oas);
          break;

        default:
          log('allOf contains currently unsupported element\'' + subschemaKey + '\'');
      }
    });
  };

  for (var allOfSchemaIndex in allOfSchema) {
    _loop3(allOfSchemaIndex);
  }
};

module.exports = {
  getGraphQLType: getGraphQLType,
  getArgs: getArgs
};