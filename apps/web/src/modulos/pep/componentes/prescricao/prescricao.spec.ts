// @vitest-environment jsdom
// Correções do M24 nas telas da prescrição: o cálculo de dose (regra 12) por kg, por m² e pelo clearance com o dado
// e a data usados, e o `calculo` que vai no item; a velocidade da solução do volume e do tempo; o adendo e a
// correção só com os tipos que a gravação cobre; o alerta da dieta de outro profissional com o link da anterior.
import { TIPOS_ADENDO, TIPOS_CORRECAO, type AlertaPrescricao } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, nextTick } from 'vue';
import { mensagensWeb } from '../../../../i18n/pt-BR.js';
import ItemEditor from './ItemEditor.vue';
import PainelAlertas from './PainelAlertas.vue';

// O jsdom não tem matchMedia nem ResizeObserver, que o combo (Select do OpenVue) usa ao abrir a lista; o apps/web
// não tem arquivo de preparação dos testes, então o spec cobre o mesmo que packages/ui/src/testes/preparar.ts.
if (!window.matchMedia) {
  window.matchMedia = (consulta: string) =>
    ({
      matches: false,
      media: consulta,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
if (!('ResizeObserver' in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

const i18n = () => criarI18n(mensagensWeb as unknown as Record<string, unknown>);
const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const global = {
  plugins: [i18n(), ui],
  stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
};
const dominios = {
  vias: [{ id: 'EV', nome: 'Endovenosa' }],
  unidades: [
    { id: 'MG', nome: 'mg' },
    { id: 'ML', nome: 'mL' },
  ],
  frequencias: [{ id: '11', nome: '06/06' }],
  motivos: [],
  tiposInfusao: [{ id: '1', nome: 'Contínua' }],
  unidadesInfusao: [{ id: '1', nome: 'mL/h' }],
};
const dados = {
  pesoKg: 70,
  alturaCm: 170,
  dataPeso: '2026-10-20T08:00:00',
  idadeAnos: 60,
  sexo: 'M' as const,
  creatinina: 1,
  dataCreatinina: '2026-10-21T07:00:00',
  clearance: 77.8,
};
const DIPIRONA = {
  produto: 501,
  nome: 'DIPIRONA SINTETICO',
  unidade: 'MG',
  padronizado: true,
  principiosAtivos: [],
  altoAlerta: false,
  controlado: false,
  antimicrobiano: false,
  doseMinima: null,
  doseMaxima: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

/** Abre o combo (SanteSelecao) e escolhe a opção pelo valor: o OpenVue anexa a lista ao body e escolhe no mousedown. */
const escolher = async (w: ReturnType<typeof mount>, testid: string, valor: string) => {
  await w.find(`[data-testid="${testid}"] [role="combobox"]`).trigger('click');
  await flushPromises();
  await nextTick();
  const opcao = document.body.querySelector<HTMLElement>(`[role="option"]:has([data-valor="${valor}"])`);
  expect(opcao, `opção ${valor} em ${testid}`).not.toBeNull();
  opcao!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await flushPromises();
  expect(w.find(`[data-testid="${testid}"]`).attributes('data-valor')).toBe(valor);
};

describe('prescrição: correções do M24', () => {
  it('regra 12: a dose por kg é calculada com o peso e a data do dado e vai no item como `calculo`', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([DIPIRONA]), { status: 200 })),
    );
    const w = mount(ItemEditor, {
      props: { grupo: 'medicamentos', dominios, categoria: 'medico', dados },
      global,
    });
    await w.find('[data-testid="busca-produto"]').setValue('dipirona');
    await w.find('[data-testid="buscar-produto"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="produto-501"]').trigger('click');
    await escolher(w, 'regra-dose', 'por-kg');
    await w.find('[data-testid="dose-por-unidade"]').setValue('2');
    await flushPromises();
    expect(w.find('[data-testid="dose-calculada"]').text()).toContain('140');
    expect(w.find('[data-testid="dose-calculada"]').text()).toContain('70 kg');
    expect(w.find('[data-testid="dose-calculada"]').text()).toContain('20/10/2026');
    expect((w.find('[data-testid="dose"]').element as HTMLInputElement).value).toBe('140');
    await escolher(w, 'unidade', 'MG');
    await escolher(w, 'via', 'EV');
    await escolher(w, 'frequencia', '11');
    await w.find('form').trigger('submit');
    const [item] = w.emitted('incluir')![0] as [{ calculo: unknown; detalhe: { dose: number } }];
    expect(item.detalhe.dose).toBe(140);
    expect(item.calculo).toEqual({
      regra: 'por-kg',
      dosePorUnidade: 2,
      peso: 70,
      dataDado: '2026-10-20T08:00:00',
    });
  });

  it('por m² (superfície corporal) e pelo clearance; sem o dado, o aviso diz o que falta', async () => {
    const w = mount(ItemEditor, {
      props: { grupo: 'medicamentos', dominios, categoria: 'medico', dados },
      global,
    });
    await escolher(w, 'regra-dose', 'por-m2');
    await w.find('[data-testid="dose-por-unidade"]').setValue('100');
    await flushPromises();
    // Mosteller: √(170 × 70 / 3600) = 1,818 m².
    expect(w.find('[data-testid="dose-calculada"]').text()).toContain('1,818 m²');
    await escolher(w, 'regra-dose', 'por-clearance');
    await flushPromises();
    expect(w.find('[data-testid="dose-calculada"]').text()).toContain('mL/min');
    const sem = mount(ItemEditor, {
      props: { grupo: 'medicamentos', dominios, categoria: 'medico', dados: { ...dados, pesoKg: null } },
      global,
    });
    await escolher(sem, 'regra-dose', 'por-kg');
    await sem.find('[data-testid="dose-por-unidade"]').setValue('2');
    await flushPromises();
    expect(sem.find('[data-testid="dose-sem-dado"]').text()).toContain('peso');
  });

  it('solução: a velocidade de infusão sai do volume e do tempo', async () => {
    const w = mount(ItemEditor, {
      props: { grupo: 'solucoes', dominios, categoria: 'medico', dados },
      global,
    });
    await w.find('[data-testid="volume-total"]').setValue('500');
    await w.find('[data-testid="tempo-minutos"]').setValue('240');
    await flushPromises();
    expect((w.find('[data-testid="velocidade"]').element as HTMLInputElement).value).toBe('125');
    expect(w.find('[data-testid="velocidade-calculada"]').text()).toContain('125 mL/h');
  });

  it('adendo e correção: só os tipos que a gravação cobre (sem glicemia; sem "se necessário" no cuidado)', async () => {
    expect(TIPOS_CORRECAO).toEqual(['medicamento', 'procedimento']);
    expect(TIPOS_ADENDO).not.toContain('solucao');
    const w = mount(ItemEditor, {
      props: {
        grupo: 'cuidados',
        dominios: { ...dominios, procedimentos: [{ id: '1', nome: 'Sinais vitais' }] },
        categoria: 'medico',
        tipos: TIPOS_ADENDO,
        seNecessarioEm: ['medicamento'],
      },
      global,
    });
    // Só o cuidado (a glicemia some): nenhuma escolha de tipo, e sem o "se necessário".
    expect(w.find('[data-testid="tipo-item"]').exists()).toBe(false);
    expect(w.find('[data-testid="se-necessario"]').exists()).toBe(false);
    const nada = mount(ItemEditor, {
      props: { grupo: 'oxigenio', dominios, categoria: 'medico', tipos: TIPOS_CORRECAO },
      global,
    });
    expect(nada.text()).toContain('não prescreve');
  });

  it('dieta de outro profissional: o alerta pede justificativa e liga à prescrição da dieta anterior', () => {
    const alerta: AlertaPrescricao = {
      id: 'dieta-de-outro',
      item: 'd1',
      tipo: 'dieta-de-outro',
      nivel: 'justificar',
      titulo: 'Já há dieta ativa no período',
      detalhe: 'A dieta ativa (prescrição 70) foi prescrita por NUTRI SINTETICO.',
      regra: 'dieta-de-outro',
      versaoRegra: 2,
      decisao: null,
      referencia: { prescricao: 70, item: 71 },
    };
    const w = mount(PainelAlertas, {
      props: {
        alertas: [alerta],
        rotulos: { d1: 'Dieta geral' },
        baseInteracoes: 'contratada',
        impede: true,
        paciente: 1001,
      },
      global,
    });
    expect(w.find('[data-testid="alerta-referencia"]').attributes('href')).toBe(
      '/pep/paciente/1001/prescricao/70',
    );
    expect(w.find('[data-testid="justificativa-alerta"]').exists()).toBe(true);
  });
});
