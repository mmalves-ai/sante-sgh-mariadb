import type { ItemMenu } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  nomeDoBanco,
  textosDasDeclaracoes,
  arquivosDeTexto,
  MENSAGENS_DA_API,
  textosDeI18n,
  textosDeTemplate,
  verificarTextos,
} from './textos-de-produto.ts';

const item = (titulo: string, rota: string | null): ItemMenu => ({
  id: 'a.b',
  area: 'ÁREA',
  grupo: null,
  caminho: ['A', titulo],
  titulo,
  selo: 'N',
  fase: 1,
  rota,
  permissao: rota ? 'x.y.ler' : null,
});

describe('textos de produto: nenhuma menção ao sistema antigo', () => {
  it('i18n: recusa os valores, ignora chaves e comentários', () => {
    const i18n = [
      '// comentário que cita o legado e o SPDATA',
      'export const m = {',
      "  legado: 'Parâmetros do banco de dados',",
      "  'continua-no-legado': 'Sem perfil correspondente',",
      "  ruim: 'Troque no sistema atual (SPDATA).',",
      "  outro: 'Dado do legado',",
      '  antigo: `Como no sistema antigo`,',
      '};',
    ].join('\n');
    expect(textosDeI18n(i18n).map((t) => t.texto)).not.toContain('continua-no-legado');
    const r = verificarTextos([{ arquivo: 'apps/web/src/i18n/pt-BR.ts', conteudo: i18n }], [], []);
    expect(r.achados.map((a) => a.linha)).toEqual([5, 6, 7]);
  });

  it('.vue: recusa texto e atributo estático do template; ignora ligações, script e interpolação', () => {
    const vue = [
      '<script setup lang="ts">',
      "const legado = 'SPDATA';",
      '</script>',
      '<template>',
      '  <!-- comentário sobre o legado -->',
      '  <p :title="legado" @click="trocarLegado()">{{ t(\'x.legado\') }}</p>',
      '  <SanteCampo placeholder="Usuário do SPDATA" data-testid="tabela-legado" />',
      '  <span>Igual ao sistema atual</span>',
      '</template>',
    ].join('\n');
    expect(textosDeTemplate(vue).map((t) => t.texto)).toEqual([
      'Usuário do SPDATA',
      'Igual ao sistema atual',
    ]);
    const r = verificarTextos([{ arquivo: 'X.vue', conteudo: vue }], [], []);
    expect(r.achados.map((a) => a.linha)).toEqual([7, 8]);
  });

  it('menu: só os itens com tela contam', () => {
    const r = verificarTextos([], [item('Coexistência com o legado', '/x'), item('Do legado', null)], []);
    expect(r.achados).toEqual([{ arquivo: 'menu:a.b', linha: 0, texto: 'Coexistência com o legado' }]);
  });

  it('exceção nominal libera o trecho; exceção sem uso é apontada', () => {
    const conteudo = "export const m = { a: 'Importar do SPDATA' };";
    const usada = { arquivo: 'i18n/a.ts', trecho: 'Importar do SPDATA', justificativa: 'teste' };
    const sobra = { arquivo: 'i18n/a.ts', trecho: 'outro', justificativa: 'teste' };
    const r = verificarTextos([{ arquivo: 'i18n/a.ts', conteudo }], [], [usada, sobra]);
    expect(r.achados).toEqual([]);
    expect(r.excecoesSemUso).toEqual([sobra]);
  });

  it('variações do nome: SP Data, sp-data, legada, sistemas antigos', () => {
    const conteudo =
      "export const m = { a: 'SP Data', b: 'sp-data', c: 'base legada', d: 'sistemas antigos', e: 'delegado' };";
    const r = verificarTextos([{ arquivo: 'i18n/a.ts', conteudo }], [], []);
    expect(r.achados.map((a) => a.texto)).toEqual(['SP Data', 'sp-data', 'base legada', 'sistemas antigos']);
  });

  it('texto que manda fazer no outro sistema sem citá-lo: "como hoje", "editor de origem", "faça no outro sistema"', () => {
    const conteudo = [
      'export const m = {',
      "  a: 'Ainda não liberado: registre como hoje.',",
      "  b: 'A mudança continua sendo feita no editor de modelos de origem.',",
      "  c: 'Para corrigir, faça a correção no outro sistema.',",
      "  d: 'Registro alterado no outro sistema depois da gravação.',",
      '};',
    ].join('\n');
    const r = verificarTextos([{ arquivo: 'i18n/a.ts', conteudo }], [], []);
    expect(r.achados.map((a) => a.linha)).toEqual([2, 3, 4]);
  });

  it('mensagens da API do PEP: só as frases contam (identificadores como "legado" não)', () => {
    const conteudo = [
      "const destino: 'legado' | 'memoria' = 'legado';",
      "const motivo = 'Modelo ainda não liberado: registre como hoje.';",
    ].join('\n');
    const arquivo = 'apps/api/src/modulos/pep/registro-servico.ts';
    expect(MENSAGENS_DA_API.test(arquivo)).toBe(true);
    expect(MENSAGENS_DA_API.test('apps/api/src/modulos/pep/registro.spec.ts')).toBe(false);
    const r = verificarTextos([{ arquivo, conteudo }], [], []);
    expect(r.achados.map((a) => a.linha)).toEqual([2]);
  });

  it('os arquivos lidos incluem i18n-*.ts e as mensagens da API do PEP', () => {
    const lidos = arquivosDeTexto(new URL('../../..', import.meta.url).pathname);
    expect(lidos).toContain('apps/web/src/modulos/pep/i18n-registro.ts');
    expect(lidos).toContain('apps/api/src/modulos/pep/registro-servico.ts');
  });
});

describe('correção do M14: textos das declarações geradas', () => {
  it('rótulo com a sigla do fornecedor (qualquer caixa) e motivo com nome do banco ou regra interna são achados', () => {
    const r = verificarTextos(
      [],
      [],
      [],
      [
        { id: 'consulta:x.y', texto: 'Cnpj spdata', motivo: false },
        { id: 'dominio:x.y', texto: 'a inclusão pede VLRREF (texto longo)', motivo: true },
        { id: 'dominio:x.z', texto: 'o ato 90 não tem linha: regra 9', motivo: true },
        { id: 'dominio:x.w', texto: 'catálogo do SADT e da TISS', motivo: true },
      ],
    );
    expect(r.achados.map((a) => a.arquivo)).toEqual(['consulta:x.y', 'dominio:x.y', 'dominio:x.z']);
    expect(nomeDoBanco('coluna ID_TBUNIDAD')).toBe('ID_TBUNIDAD');
    expect(nomeDoBanco('Valores de referência')).toBeNull();
  });
  it('as declarações do lote estão limpas', () => {
    const t = textosDasDeclaracoes();
    expect(t.length).toBeGreaterThan(1000);
    expect(verificarTextos([], [], [], t).achados).toEqual([]);
  });
  it('correção do M30: no faturamento, "sistema em uso" e "outro sistema" também barram; o i18n.ts do módulo entra', () => {
    const i18n =
      "export const m = { a: 'A conta é a mesma do sistema em uso.', b: 'só o outro sistema registra' };";
    const api = "avisos.push('Gere a conta complementar no outro sistema.'); const x = 'codigo-interno';";
    const r = verificarTextos(
      [
        { arquivo: 'apps/web/src/modulos/faturamento/i18n.ts', conteudo: i18n },
        { arquivo: 'apps/api/src/modulos/faturamento/servico.ts', conteudo: api },
        { arquivo: 'apps/web/src/modulos/pep/i18n-registro.ts', conteudo: i18n },
      ],
      [],
      [],
    );
    expect(r.achados.map((a) => a.arquivo)).toEqual([
      'apps/web/src/modulos/faturamento/i18n.ts',
      'apps/web/src/modulos/faturamento/i18n.ts',
      'apps/api/src/modulos/faturamento/servico.ts',
    ]);
    expect(MENSAGENS_DA_API.test('apps/api/src/modulos/faturamento/servico.ts')).toBe(true);
    expect(MENSAGENS_DA_API.test('apps/api/src/modulos/faturamento/faturamento.spec.ts')).toBe(false);
  });

  it('revisão do M44.3: "fornecedor anterior" barra em todo módulo; "sistema anterior" barra no escopo estrito', () => {
    const i18n =
      "export const m = { a: 'Configuração recebida do fornecedor anterior.', b: 'Conferida no sistema anterior.' };";
    const r = verificarTextos(
      [
        { arquivo: 'apps/web/src/modulos/adt/i18n-regulacao.ts', conteudo: i18n },
        { arquivo: 'apps/web/src/modulos/financeiro/i18n.ts', conteudo: i18n },
      ],
      [],
      [],
    );
    expect(r.achados.map((a) => `${a.arquivo}:${a.texto}`)).toEqual([
      'apps/web/src/modulos/adt/i18n-regulacao.ts:Configuração recebida do fornecedor anterior.',
      'apps/web/src/modulos/financeiro/i18n.ts:Configuração recebida do fornecedor anterior.',
      'apps/web/src/modulos/financeiro/i18n.ts:Conferida no sistema anterior.',
    ]);
  });
});
