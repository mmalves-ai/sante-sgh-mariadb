// @vitest-environment jsdom
// Componentes do prontuário (M15): o texto formatado vira texto (nenhuma marcação do conteúdo é interpretada),
// os campos do formulário em grade com as seções, as respostas com a grade e a marca "a confirmar", e as marcas
// legais com texto (cor nunca é a única informação). As rotas exigem as permissões do catálogo.
import { criarI18n } from '@sgh/ui';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import { criarRoteador } from '../../../roteador.js';
import CamposFormulario from './CamposFormulario.vue';
import ItensRespostas from './ItensRespostas.vue';
import MarcasRegistro from './MarcasRegistro.vue';
import TextoFormatado from './TextoFormatado.vue';

const i18n = () => criarI18n(mensagensWeb as unknown as Record<string, unknown>);
const global = { plugins: [i18n()], stubs: { RouterLink: { template: '<a><slot /></a>' } } };

describe('componentes do prontuário', () => {
  it('texto formatado: marcação no conteúdo continua texto; negrito, centro e recuo', () => {
    const w = mount(TextoFormatado, {
      props: {
        texto: {
          paragrafos: [
            {
              alinhamento: 'centro',
              recuo: 0,
              trechos: [{ texto: 'TITULO', negrito: true, italico: false, sublinhado: false, cor: 1 }],
            },
            {
              alinhamento: 'esquerda',
              recuo: 2,
              trechos: [
                {
                  texto: '<img src=x onerror=alert(1)>',
                  negrito: false,
                  italico: false,
                  sublinhado: false,
                  cor: 0,
                },
              ],
            },
          ],
          cores: ['#000000', '#ff0000'],
          ignorados: {},
          conteudoAtivoRemovido: 0,
        },
      },
      global,
    });
    expect(w.find('img').exists()).toBe(false);
    expect(w.text()).toContain('<img src=x onerror=alert(1)>');
    expect(w.find('p.alinhar-centro span.negrito.destaque').text()).toBe('TITULO');
    expect(w.findAll('p')[1]!.attributes('style')).toContain('padding-inline-start');
  });

  it('campos do formulário: seção como título, valor de lista e marcas', () => {
    const base = { topo: 0, esquerda: 0, colunas: 12, autopreenchido: false, naoMapeado: false };
    const w = mount(CamposFormulario, {
      props: {
        rotulo: 'Formulário',
        campos: [
          {
            ...base,
            nome: 'a',
            classe: 'TGroupBoxPep',
            titulo: 'SEÇÃO',
            secao: true,
            valor: { tipo: 'vazio' },
          },
          {
            ...base,
            nome: 'b',
            classe: 'TfRespCheckListBox',
            titulo: 'Sintomas',
            secao: false,
            valor: { tipo: 'lista', itens: ['Febre'] },
            colunas: 6,
            autopreenchido: true,
          },
          {
            ...base,
            nome: 'c',
            classe: 'TX',
            titulo: 'Antigo',
            secao: false,
            valor: { tipo: 'texto', texto: 'v' },
            naoMapeado: true,
          },
        ],
      },
      global,
    });
    expect(w.find('h3').text()).toBe('SEÇÃO');
    expect(w.text()).toContain('Febre');
    expect(w.text()).toContain('Preenchido automaticamente');
    expect(w.text()).toContain('Campo de tipo antigo');
  });

  it('respostas: grade e a marca "a confirmar"; marcas legais com texto', () => {
    const r = mount(ItensRespostas, {
      props: {
        itens: [
          {
            ordem: '01',
            titulo: 'Sinais',
            tipo: 'Colunas',
            valores: [],
            grade: { colunas: ['Hora', 'Valor'], linhas: [['08:00', '12']] },
            autopreenchido: false,
            aConfirmar: 'índice',
            itens: [],
          },
        ],
      },
      global,
    });
    expect(r.findAll('th').map((x) => x.text())).toEqual(['Hora', 'Valor']);
    expect(r.text()).toContain('a confirmar');
    const m = mount(MarcasRegistro, {
      props: {
        paciente: 1,
        detalhe: true,
        marcas: {
          suspenso: true,
          suspensoEm: '2024-05-02T10:11',
          justificativaSuspensao: 'paciente errado',
          corrigeRegistro: 7,
          retroativo: false,
          justificativaRetroativo: null,
          supervisao: true,
          semConteudo: false,
          dataImpossivel: false,
          semAssinaturaIcp: true,
        },
      },
      global,
    });
    expect(m.find('[data-testid="marca-suspenso"]').text()).toBe('Suspenso');
    expect(m.find('[data-testid="detalhe-suspenso"]').text()).toContain('02/05/2024 10:11');
    expect(m.text()).toContain('registro 7');
    expect(m.find('[data-testid="aviso-icp"]').exists()).toBe(true);
  });

  it('as rotas do prontuário exigem pep.prontuario.ler; o registro de acesso, auditoria.acessos.ler', async () => {
    const sessao = (permissoes: string[]) => async () => ({
      usuario: { id: 's', nome: 'S' },
      rede: null,
      estabelecimentos: [],
      estabelecimentoAtivo: null,
      permissoes,
      sintetica: true,
      bloqueioInatividadeSegundos: 0,
    });
    for (const [caminho, perm, nome] of [
      ['/pep/prontuario', 'pep.prontuario.ler', 'pep.prontuario'],
      ['/pep/prontuario/1003/registro/900001', 'pep.prontuario.ler', 'pep.prontuario.registro'],
      [
        '/administracao/auditoria/acessos-prontuario',
        'auditoria.acessos.ler',
        'auditoria.acessos-prontuario',
      ],
    ] as const) {
      const sem = criarRoteador(sessao(['acesso.inicio.ler']), { historico: createMemoryHistory() });
      await sem.push(caminho);
      expect(sem.currentRoute.value.name).toBe('sem-permissao');
      const com = criarRoteador(sessao(['acesso.inicio.ler', perm]), { historico: createMemoryHistory() });
      await com.push(caminho);
      expect(com.currentRoute.value.name).toBe(nome);
    }
  });
});
