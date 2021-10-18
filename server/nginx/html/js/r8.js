'use strict';

// credit https://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid
function uuidv4() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

class R8Term {
    static fromJson(pkg, json) {
        throw "not implemented";
    }

    constructor(pkg) {
        this._package = pkg;
    }

    get value() {
        throw "not implemented";
    }

    set value(newValues) {
        throw "not implemented";
    }

    get json() {
        throw "not implemented";
    }
}

class R8ExpressionTerm extends R8Term {
    static _lexRules = [
        ['ws', /\s+/],
        ['name', /[a-zA-Z]\w*/],
        ['operator', /[\+\-\*\/%]/],
        ['parenthesis', /[\(\)]/],
        ['error', /./]
    ];

    static _operatorPrecedence = {
        '+': 0,
        '-': 0,
        '*': 1,
        '/': 1,
        '%': 2
    };

    static _lexRegex = '(?:' + R8ExpressionTerm._lexRules.map(v => '(?<' + v[0] + '>' + v[1].toString().substr(1, v[1].toString().length-2) + ')').join('|') + ')';

    static* tokenizeExpression (expression) {
        const matches = expression.matchAll(R8ExpressionTerm._lexRegex);
        let i;
        while ((i = matches.next()) && !i.done) {
            const match = i.value;

            for (const group in match.groups) {
                if (match.groups[group]) {
                    yield {
                        "type": group,
                        "value": match.groups[group]
                    };
                }
            }
        }
    }

    static parseExpression(expression) {
        const tokenStream = [];
        const outputQueue = [];
        const operatorStack = [];

        function popOperators(o1) {
            while (operatorStack.length > 0) {
                const o2 = operatorStack[operatorStack.length-1];

                if (R8ExpressionTerm._operatorPrecedence[o2.value] >=
                        R8ExpressionTerm._operatorPrecedence[o1.value]) {
                    outputQueue.push(operatorStack.pop());
                } else {
                    break;
                }
            }
        }

        function throwEvalError(message, token) {
            throw message + ': ' + tokenStream.map(t => t.value).join('') + '_' + token.value + '_';
        }

        for (const token of R8ExpressionTerm.tokenizeExpression(expression)) {
            switch (token.type) {
                case 'name': {
                    outputQueue.push(token);
                } break;

                case 'operator': {
                    popOperators(token);

                    operatorStack.push(token);
                } break;

                case 'parenthesis': {
                    if (token.value == '(') {
                        operatorStack.push(token);
                    } else {
                        while (operatorStack.length > 0
                                && operatorStack[operatorStack.length-1].value != '(') {
                            outputQueue.push(operatorStack.pop());
                        }

                        const lastOperator = operatorStack.pop();

                        if (!lastOperator || lastOperator.value != '(') {
                            throwEvalError('mismatched parenthesis', token);
                        }
                    }
                } break;

                case 'error': {
                    throwEvalError('invalid token', token);
                } break;
            }

            tokenStream.push(token);
        }

        while (operatorStack.length > 0) {
            outputQueue.push(operatorStack.pop());
        }

        return outputQueue;
    }

    get value() {
        return this._evaluateExpression();
    }

    set value(newValue) {
        this._expression = R8ExpressionTerm.parseExpression(newValue);
        this._expressionSource = newValue;
    }

    _evaluateExpression() {
        if (!this._expression) {
            throw 'invalid or missing expression';
        }

        const stack = [];

        this._expression.forEach(token => {
            switch (token.type) {
                case 'name': {
                    const term = this._package.getTerm(token.value);
                    if (term === undefined) {
                        throw 'undefined term: '  + token.value;
                    }

                    stack.push(term.value);
                } break;

                case 'operator': {
                    switch (token.value) {
                        case '+': {
                            stack.push(stack.pop() + stack.pop());
                        } break;

                        case '-': {
                            stack.push(stack.pop() + stack.pop());
                        } break;

                        case '*': {
                            stack.push(stack.pop() * stack.pop());
                        } break;

                        case '/': {
                            stack.push(stack.pop() / stack.pop());
                        } break;

                        case '%': {
                            stack.push(stack.pop()/100.0);
                        } break;
                    }
                } break;
            }
        });

        if (stack.length == 1) {
            return stack.pop();
        } else {
            throw 'error evaluating term: ' + this._expression;
        }
    }

    static fromJson(pkg, json) {
        const term = new R8ExpressionTerm(pkg);

        term.value = json.expressionSource;

        return term;
    }

    get json() {
        return  {
            'expressionSource': this._expressionSource
        }
    }
}

class R8InputTerm extends R8Term {
    _value = undefined;

    static fromJson(pkg, json) {
        const term = new R8InputTerm(pkg);

        return term;
    }

    get value() {
        return this._value;
    }

    set value(newValue) {
        this._value = newValue;
    }

    get json() {
        return {
        }
    }
}

class R8ConstantTerm extends R8Term {
    _value = undefined;

    static fromJson(pkg, json) {
        const term = new R8ConstantTerm(pkg);

        term.value = json.value;

        return term;
    }

    get value() {
        return this._value;
    }

    set value(newValue) {
        this._value = newValue;
    }

    get json() {
        return {
            "value": this.value
        }
    }
}

class R8TableTerm extends R8Term {

}

class R8IntegrationTerm extends R8Term {

}

class R8EnvironmentTerm extends R8Term  {

}

const TERM_TYPES = {
    'expression': R8ExpressionTerm,
    'input': R8InputTerm,
    'constant': R8ConstantTerm,
    'table': R8TableTerm,
    'integration': R8IntegrationTerm,
    'environment': R8EnvironmentTerm
};

const TERM_TYPE_NAMES = {};
Object.keys(TERM_TYPES).forEach(name => {
    TERM_TYPE_NAMES[TERM_TYPES[name]] = name;
});

class R8Package {
    static fromJson(host, json) {
        const pkg = new R8Package(host);

        pkg._terms = {};

        for (const name in json.terms) {
            const term = json.terms[name];
            pkg.defineTerm(name,
                    TERM_TYPES[term.type].fromJson(pkg, term.data));
        }

        return pkg;
    }

    _terms = {};

    constructor(host) {
        this._host = host;
        this._id = uuidv4();
    }

    get host() {
        return this._host;
    }

    get name() {
        return this.host.getPackageName(this);
    }

    get id() {
        return this._id;
    }

    get json() {
        const out = {
            "terms": {}
        };

        Object.keys(this._terms).forEach(name => {
            const term = this._terms[name];

            out.terms[name] = {
                "name": name,
                "type": TERM_TYPE_NAMES[term.constructor],
                "data": term.json
            };
        });

        return out;
    }

    createTerm(type, value=undefined) {
        if (!(type in TERM_TYPES)) {
            throw 'unknown term type "' + type + '"';
        }

        const term = new TERM_TYPES[type](this);
        if (value !== undefined) {
            term.value = value;
        }

        return term;
    }

    getTerm(term) {
        return this._terms[term];
    }

    defineTerm(name, term) {
        if (term === undefined || !(term instanceof R8Term)) {
            throw 'invalid term definition: ' + term;
        }

        this._terms[name] = term;
    }
}

export class R8Host {
    _packages = {};

    static get host() {
        if (!this._theHost) {
            this._theHost = new this();
        }

        return this._theHost;
    }

    get packages() {
        return this._packages;
    }

    createPackage(name) {
        if (name in this.packages) {
            throw `package ${name} already exists`;
        }

        this.packages[name] = new R8Package(this);

        this._syncStore();

        return this.packages[name];
    }

    deletePackage(name) {
        if (!(name in this.packages)) {
            throw `package ${name} does not exist`;
        }

        delete this.packages[name];

        this._syncStore();
    }

    getPackageName(pkg) {
        return Object.keys(this.packages).find(key => this.packages[key] === pkg);
    }

    _syncStore() {}
}

export class R8HostLocal extends R8Host  {
    get packages() {
        if (this._packages === undefined) {
            this._packages = JSON.parse(localStorage.getItem('r8_packages') || '{}');
            for  (const name in this._packages) {
                this._packages[name] = R8Package.fromJson(this, this._package[name]);
            }
        }

        return this._packages;
    }

    _syncStore() {
        const storeData = {};
        for (const name in this.packages) {
            storeData[name] = this.packages[name].json;
        }

        localStorage.setItem('r8_packages', storeData);
    }
}
