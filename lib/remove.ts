import ts from 'typescript';
import { FileService } from './FileService.js';
import { applyTextChanges } from './util/applyTextChanges.js';
import chalk from 'chalk';
import {
  applyCodeFix,
  fixIdDelete,
  fixIdDeleteImports,
} from './util/applyCodeFix.js';

const findFirstNodeOfKind = (root: ts.Node, kind: ts.SyntaxKind) => {
  let result: ts.Node | undefined;
  const visitor = (node: ts.Node) => {
    if (result) {
      return;
    }

    if (node.kind === kind) {
      result = node;
      return;
    }
    ts.forEachChild(node, visitor);
  };

  ts.forEachChild(root, visitor);

  return result;
};

const IGNORE_COMMENT = 'ts-remove-unused-skip';

const getLeadingComment = (node: ts.Node) => {
  const sourceFile = node.getSourceFile();
  const fullText = sourceFile.getFullText();
  const ranges = ts.getLeadingCommentRanges(fullText, node.getFullStart());

  if (!ranges) {
    return '';
  }

  return ranges.map((range) => fullText.slice(range.pos, range.end)).join('');
};

type SupportedNode =
  | ts.VariableStatement
  | ts.FunctionDeclaration
  | ts.InterfaceDeclaration
  | ts.TypeAliasDeclaration
  | ts.ExportAssignment
  | ts.ExportSpecifier
  | ts.ClassDeclaration;

const isTargetWithIgnore = (node: ts.Node): node is SupportedNode => {
  if (
    ts.isExportAssignment(node) ||
    ts.isExportSpecifier(node) ||
    ts.isVariableStatement(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isClassDeclaration(node)
  ) {
    if (getLeadingComment(node).includes(IGNORE_COMMENT)) {
      return true;
    }
  }
  return false;
};

const isTarget = (node: ts.Node): node is SupportedNode => {
  if (ts.isExportAssignment(node) || ts.isExportSpecifier(node)) {
    if (getLeadingComment(node).includes(IGNORE_COMMENT)) {
      return false;
    }

    return true;
  }

  if (
    ts.isVariableStatement(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isClassDeclaration(node)
  ) {
    const hasExportKeyword = !!findFirstNodeOfKind(
      node,
      ts.SyntaxKind.ExportKeyword,
    );

    if (!hasExportKeyword) {
      return false;
    }

    if (getLeadingComment(node).includes(IGNORE_COMMENT)) {
      return false;
    }

    return true;
  }

  return false;
};

const findReferences = (node: SupportedNode, service: ts.LanguageService) => {
  if (ts.isVariableStatement(node)) {
    const variableDeclaration = findFirstNodeOfKind(
      node,
      ts.SyntaxKind.VariableDeclaration,
    );

    if (!variableDeclaration) {
      return undefined;
    }

    const references = service.findReferences(
      node.getSourceFile().fileName,
      variableDeclaration.getStart(),
    );

    return references;
  }

  if (
    ts.isFunctionDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isExportSpecifier(node) ||
    ts.isClassDeclaration(node)
  ) {
    return service.findReferences(
      node.getSourceFile().fileName,
      node.getStart(),
    );
  }

  if (ts.isExportAssignment(node)) {
    const defaultKeyword = node
      .getChildren()
      .find((n) => n.kind === ts.SyntaxKind.DefaultKeyword);

    if (!defaultKeyword) {
      return undefined;
    }

    return service.findReferences(
      node.getSourceFile().fileName,
      defaultKeyword.getStart(),
    );
  }

  throw new Error(`unexpected node type: ${node satisfies never}`);
};

const isUsedFile = (
  languageService: ts.LanguageService,
  sourceFile: ts.SourceFile,
) => {
  let isUsed = false;

  const visit = (node: ts.Node) => {
    if (isUsed) {
      return;
    }

    if (isTargetWithIgnore(node)) {
      isUsed = true;
      return;
    } else if (isTarget(node)) {
      const references = findReferences(node, languageService);

      if (!references) {
        return;
      }

      const count = references.flatMap((v) => v.references).length;

      if (ts.isExportSpecifier(node) && count > 2) {
        // for export specifiers, there will be at least two reference, the declaration itself and the export specifier
        isUsed = true;
      } else if (count > 1) {
        // there will be at least one reference, the declaration itself
        isUsed = true;
      }

      return;
    }

    node.forEachChild(visit);
  };

  sourceFile.forEachChild(visit);

  return isUsed;
};

const getUnusedExports = (
  languageService: ts.LanguageService,
  sourceFile: ts.SourceFile,
) => {
  const result: SupportedNode[] = [];

  const visit = (node: ts.Node) => {
    if (isTarget(node)) {
      const references = findReferences(node, languageService);

      if (!references) {
        return;
      }

      const count = references.flatMap((v) => v.references).length;

      if (ts.isExportSpecifier(node) && count === 2) {
        // for export specifiers, there will be at least two reference, the declaration itself and the export specifier
        result.push(node);
      } else if (count === 1) {
        // there will be at least one reference, the declaration itself
        result.push(node);
      }

      return;
    }

    node.forEachChild(visit);
  };

  sourceFile.forEachChild(visit);

  return result;
};

const getUpdatedExportDeclaration = (
  exportDeclaration: ts.ExportDeclaration,
  removeTarget: ts.ExportSpecifier,
) => {
  const tmpFile = ts.createSourceFile(
    'tmp.ts',
    exportDeclaration.getText(),
    exportDeclaration.getSourceFile().languageVersion,
  );

  const transformer: ts.TransformerFactory<ts.SourceFile> =
    (context: ts.TransformationContext) => (rootNode: ts.SourceFile) => {
      const visitor = (node: ts.Node): ts.Node | undefined => {
        if (
          ts.isExportSpecifier(node) &&
          node.getText(tmpFile) === removeTarget.getText()
        ) {
          return undefined;
        }
        return ts.visitEachChild(node, visitor, context);
      };

      return ts.visitEachChild(rootNode, visitor, context);
    };

  const result = ts.transform(tmpFile, [transformer]).transformed[0];

  const printer = ts.createPrinter();

  return result ? printer.printFile(result) : '';
};

const getTextChanges = (
  languageService: ts.LanguageService,
  sourceFile: ts.SourceFile,
) => {
  const changes: ts.TextChange[] = [];
  for (const node of getUnusedExports(languageService, sourceFile)) {
    if (ts.isExportSpecifier(node)) {
      const specifierCount = Array.from(node.parent.elements).length;

      if (specifierCount === 1) {
        // special case: if the export specifier is the only specifier in the export declaration, we want to remove the whole export declaration
        changes.push({
          newText: '',
          span: {
            start: node.parent.parent.getFullStart(),
            length: node.parent.parent.getFullWidth(),
          },
        });
        continue;
      }

      changes.push({
        newText: getUpdatedExportDeclaration(node.parent.parent, node),
        span: {
          start: node.parent.parent.getStart(),
          length: node.parent.parent.getWidth(),
        },
      });

      continue;
    }

    if (ts.isExportAssignment(node)) {
      changes.push({
        newText: '',
        span: {
          start: node.getFullStart(),
          length: node.getFullWidth(),
        },
      });
      continue;
    }

    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
      const identifier = node
        .getChildren()
        .find((n) => n.kind === ts.SyntaxKind.Identifier);

      // when the identifier is not found, it's likely a default export of an unnamed function/class declaration.
      // in this case, we want to remove the whole declaration
      if (!identifier) {
        changes.push({
          newText: '',
          span: {
            start: node.getFullStart(),
            length: node.getFullWidth(),
          },
        });

        continue;
      }
    }

    // we want to correctly remove 'default' when its a default export so we get the syntaxList node instead of the exportKeyword node
    // note: the first syntaxList node should contain the export keyword
    const syntaxList = node
      .getChildren()
      .find((n) => n.kind === ts.SyntaxKind.SyntaxList);

    if (!syntaxList) {
      throw new Error('syntax list not found');
    }

    changes.push({
      newText: '',
      span: {
        start: syntaxList.getFullStart(),
        length: syntaxList.getFullWidth(),
      },
    });
  }

  return changes;
};

export const removeUnusedExport = ({
  fileService,
  targetFile,
  languageService,
  deleteUnusedFile = false,
  enableCodeFix = false,
  stdout,
}: {
  fileService: FileService;
  targetFile: string | string[];
  languageService: ts.LanguageService;
  enableCodeFix?: boolean;
  deleteUnusedFile?: boolean;
  stdout?: NodeJS.WriteStream;
}) => {
  const program = languageService.getProgram();

  if (!program) {
    throw new Error('program not found');
  }

  for (const file of Array.isArray(targetFile) ? targetFile : [targetFile]) {
    const sourceFile = program.getSourceFile(file);

    if (!sourceFile) {
      continue;
    }

    if (deleteUnusedFile) {
      const isUsed = isUsedFile(languageService, sourceFile);

      if (!isUsed) {
        fileService.delete(file);

        stdout?.write(
          `${chalk.green.bold('✓')} ${file} ${chalk.gray('(deleted)')}\n`,
        );
        continue;
      }
    }

    const changes = getTextChanges(languageService, sourceFile);

    if (changes.length === 0) {
      stdout?.write(`${chalk.green.bold('✓')} ${file}\n`);

      continue;
    }

    const oldContent = fileService.get(file);
    let newContent = applyTextChanges(oldContent, changes);

    if (enableCodeFix) {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        fileService.set(file, newContent);

        const result = applyCodeFix({
          fixId: fixIdDelete,
          fileName: file,
          languageService,
        });

        if (result === newContent) {
          break;
        }

        newContent = result;
      }

      fileService.set(file, newContent);

      newContent = applyCodeFix({
        fixId: fixIdDeleteImports,
        fileName: file,
        languageService,
      });
    }

    fileService.set(file, newContent);

    stdout?.write(
      `${chalk.green.bold('✓')} ${file} ${chalk.gray('(modified)')}\n`,
    );
  }
};
