// Interpretador de REFERÊNCIA das expressões do formulário (lê o programa e executa comando a comando, com as
// variáveis locais): é contra ele que o teste de regressão confere a tradução para JSON Logic (mesmas entradas,
// mesmo resultado; regra 5 da ficha do M22). Não é usado na tela: lá vale a regra em JSON Logic.
import { type Comando, ehContexto, type No, nomeCanonico } from './pascal.js';
import {
  aritmetica,
  chamar,
  comparar,
  type ContextoRegras,
  negativo,
  type Valor,
  verdadeiro,
} from './valores.js';

export function avaliarNo(n: No, locais: Map<string, Valor>, ctx: ContextoRegras): Valor {
  switch (n.t) {
    case 'num':
    case 'txt':
    case 'bool':
      return n.v;
    case 'id': {
      const nome = nomeCanonico(n.nome);
      if (ehContexto(nome)) return ctx.valores[nome] ?? null;
      return locais.has(nome) ? locais.get(nome)! : null;
    }
    case 'un':
      return n.op === 'not'
        ? !verdadeiro(avaliarNo(n.a, locais, ctx))
        : negativo(avaliarNo(n.a, locais, ctx));
    case 'bin': {
      if (n.op === 'and')
        return verdadeiro(avaliarNo(n.a, locais, ctx)) && verdadeiro(avaliarNo(n.b, locais, ctx));
      if (n.op === 'or')
        return verdadeiro(avaliarNo(n.a, locais, ctx)) || verdadeiro(avaliarNo(n.b, locais, ctx));
      const a = avaliarNo(n.a, locais, ctx);
      const b = avaliarNo(n.b, locais, ctx);
      if (n.op === '=' || n.op === '<>' || n.op === '<' || n.op === '<=' || n.op === '>' || n.op === '>=')
        return comparar(n.op, a, b);
      return aritmetica(n.op, a, b);
    }
    case 'chamada':
      return chamar(
        n.nome,
        n.args.map((a) => avaliarNo(a, locais, ctx)),
        ctx,
      );
  }
}

// As variáveis locais vêm primeiro: com (comando, mapa) a regra genérica de injeção de cabeçalho do Semgrep lia
// `locais.set(…, c.alvo)` como `res.set(…, req.x)` (falso positivo; integração M14×M22).
function executar(locais: Map<string, Valor>, c: Comando, ctx: ContextoRegras): void {
  switch (c.t) {
    case 'vazio':
      return;
    case 'atrib':
      locais.set(nomeCanonico(c.alvo), avaliarNo(c.e, locais, ctx));
      return;
    case 'se':
      if (verdadeiro(avaliarNo(c.c, locais, ctx))) executar(locais, c.entao, ctx);
      else if (c.senao) executar(locais, c.senao, ctx);
      return;
    case 'bloco':
      for (const x of c.cmds) executar(locais, x, ctx);
  }
}

/** Executa o programa e devolve `result` (null quando o programa não o atribui). */
export function interpretar(programa: Comando, ctx: ContextoRegras): Valor {
  const locais = new Map<string, Valor>();
  executar(locais, programa, ctx);
  return locais.has('result') ? locais.get('result')! : null;
}
