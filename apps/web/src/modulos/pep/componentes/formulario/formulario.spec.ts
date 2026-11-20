// @vitest-environment jsdom
// FormRenderer do M22: a seção vira fieldset com legenda; os campos de múltipla escolha emitem a lista marcada;
// o campo desabilitado pela regra mantém o valor e avisa; o valor trazido do registro anterior pede confirmação
// (botão com texto, nunca só cor); a pergunta a confirmar (ambígua) não edita; o modo de visualização mostra
// "—" no não respondido e a impressão o esconde. A cópia local da digitação funciona sem IndexedDB.
import type { CampoRegistro, RespostaRegistro } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { mensagensWeb } from '../../../../i18n/pt-BR.js';
import { apagarLocal, chaveLocal, guardarLocal, lerLocal } from '../../rascunho-local.js';
import FormRenderer from './FormRenderer.vue';

import type { App } from 'vue';

const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const global = { plugins: [criarI18n(mensagensWeb as unknown as Record<string, unknown>), ui] };

const campo = (
  vinculo: number,
  tipo: CampoRegistro['tipo'],
  titulo: string,
  extra: Partial<CampoRegistro> = {},
): CampoRegistro => ({
  linkId: `v${vinculo}`,
  vinculo,
  componente: `cmp${vinculo}`,
  tipo,
  titulo,
  obrigatorio: false,
  unidade: null,
  tamanhoMaximo: null,
  colunas: 6,
  opcoes: [],
  colunasGrade: [],
  habilitar: null,
  calcular: null,
  regraPendente: false,
  manterHistorico: 0,
  ambiguo: false,
  itens: [],
  ...extra,
});

const campos: CampoRegistro[] = [
  campo(1, 'secao', 'RELATÓRIO SINTETICO', {
    colunas: 12,
    itens: [
      campo(2, 'multipla', 'Dieta', {
        opcoes: [
          { indice: 0, texto: 'Zero' },
          { indice: 1, texto: 'Oral' },
          { indice: 2, texto: 'Enteral' },
        ],
      }),
      campo(3, 'data', 'Data da punção'),
      campo(4, 'texto', 'Observação', { manterHistorico: 1 }),
      campo(5, 'escolha', 'Lista a confirmar', { ambiguo: true }),
      campo(6, 'quantidade', 'Frequência cardíaca', { unidade: 'bpm' }),
    ],
  }),
];
const resp = (vinculo: number, valor: RespostaRegistro['valor'], auto = false): RespostaRegistro => ({
  vinculo,
  valor,
  autopreenchido: auto,
  confirmado: false,
});

describe('FormRenderer (M22)', () => {
  it('edição: seção, múltipla escolha, campo desabilitado com valor, valor trazido e pergunta a confirmar', async () => {
    const w = mount(FormRenderer, {
      props: {
        campos,
        modo: 'edicao',
        titulo: 'ENF SINTETICO',
        respostas: {
          3: resp(3, { tipo: 'data', data: '2026-10-01' }),
          4: resp(4, { tipo: 'texto', texto: 'anterior' }, true),
        },
        desabilitados: new Set([3]),
      },
      global,
    });
    expect(w.find('form').attributes('aria-label')).toBe('Formulário ENF SINTETICO');
    expect(w.find('[data-testid="secao-v1"] legend').text()).toBe('RELATÓRIO SINTETICO');
    const caixas = w.findAll('[data-testid="campo-v2"] input[type="checkbox"]');
    expect(caixas).toHaveLength(3);
    await caixas[2]!.setValue(true);
    expect(w.emitted('atualizar')?.at(-1)).toEqual([2, { tipo: 'multipla', indices: [2] }]);
    const data = w.find('[data-testid="campo-v3"]');
    expect(data.classes()).toContain('desabilitado');
    expect(data.find('fieldset').attributes('disabled')).toBeDefined();
    expect(data.text()).toContain('o valor digitado é mantido');
    const trazido = w.find('[data-testid="campo-v4"]');
    expect(trazido.text()).toContain('confirme ou altere');
    const botoes = trazido.findAll('button');
    expect(botoes.map((b) => b.text())).toEqual(
      expect.arrayContaining(['Confirmar o valor de Observação', 'Histórico de Observação']),
    );
    await botoes.find((b) => b.text().startsWith('Confirmar'))!.trigger('click');
    expect(w.emitted('confirmar')).toEqual([[4]]);
    const ambiguo = w.find('[data-testid="campo-v5"]');
    expect(ambiguo.find('[role="combobox"]').exists()).toBe(false);
    expect(ambiguo.text()).toContain('a confirmar pela comissão');
    const fc = w.find('[data-testid="campo-v6"]');
    expect(fc.text()).toContain('bpm');
    await fc.find('input').setValue('72,5');
    expect(w.emitted('atualizar')?.at(-1)).toEqual([6, { tipo: 'numero', valor: 72.5 }]);
  });

  it('visualização mostra "—" no não respondido; impressão esconde', () => {
    const props = { campos, titulo: 'X', respostas: { 6: resp(6, { tipo: 'numero', valor: 80 }) } };
    const v = mount(FormRenderer, { props: { ...props, modo: 'visualizacao' as const }, global });
    expect(v.find('[data-testid="campo-v3"]').text()).toContain('—');
    expect(v.find('[data-testid="campo-v6"]').text()).toContain('80');
    expect(v.findAll('input')).toHaveLength(0);
    const p = mount(FormRenderer, { props: { ...props, modo: 'impressao' as const }, global });
    expect(p.find('[data-testid="campo-v3"]').exists()).toBe(false);
    expect(p.find('[data-testid="campo-v6"]').exists()).toBe(true);
  });
});

describe('cópia local da digitação (M22)', () => {
  it('guarda, lê e apaga sem IndexedDB (memória da aba)', async () => {
    const dono = { rede: 'r', estabelecimento: 'aa', login: 'SINT.MEDICO' };
    const chave = chaveLocal(dono, 1003, 61, null);
    expect(chave).toBe('r|aa|SINT.MEDICO|1003|61|novo');
    await guardarLocal(dono, chave, {
      paciente: 1003,
      modelo: 61,
      atendimento: 10031,
      dataHoraClinica: '2026-10-21T08:00',
      justificativa: '',
      respostas: [resp(4, { tipo: 'texto', texto: 'x' })],
      rascunho: null,
      guardadoEm: new Date().toISOString(),
    });
    expect((await lerLocal(dono, chave))?.respostas).toHaveLength(1);
    await apagarLocal(chave);
    expect(await lerLocal(dono, chave)).toBeNull();
  });
});
