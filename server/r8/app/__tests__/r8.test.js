const { R8Linter } = require('r8');

test('R8Linter', () => {
	expect(() => { new R8Linter('invalid-strategy') }).toThrow();

	R8Linter.idPolicies.forEach((strategy) => {	
		const linter = new R8Linter(strategy);
		expect(linter).toBeInstanceOf(R8Linter);
		expect(linter.validateIdentifier(strategy)).toBeTruthy();
		expect(linter.validateIdentifier('111badidentifier111')).toBeFalsy();
	});
});
