<script setup lang="ts">
// "Certificação SBIS" (M59-F5; ficha do M59, seções 7, 8 regras 9 e 10, e 13; cap-13 §13.6): ligada a partir da
// "Trilha de auditoria". Mostra o recorte dos requisitos (por nível e por regime), o pacote de evidências (o servidor
// mede seis itens; os demais são gerados a cada versão), se a auditoria formal pode ser aberta e o certificado. Quem
// tem auditoria.sbis.avaliar (escritório da qualidade) abre o ciclo (autoavaliação mensal, pré-auditoria, auditoria
// formal), avalia cada requisito, registra a correção da não conformidade, verifica a correção de outra pessoa,
// conclui com o parecer (senha de novo) ou cancela. O auditor só lê. As recusas do servidor aparecem com o texto do
// contrato; o resto vai à MensagemErro.
import {
  type CicloSbis,
  type ItemCicloSbis,
  NIVEIS_SBIS,
  ORIGENS_NC_SBIS,
  PERMISSOES_M59_F5_CODIGOS as P,
  REGIMES_SBIS,
  SEVERIDADES_NC_SBIS,
  TIPOS_CICLO_SBIS,
  type ResultadoItemSbis,
  type TipoCicloSbis,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { codigoDoErro } from '../../acesso/api-identidade.js';
import {
  abrirCicloSbis,
  avaliarItemSbis,
  buscarCicloSbis,
  buscarPainelSbis,
  cancelarCicloSbis,
  concluirCicloSbis,
  corrigirItemSbis,
  verificarItemSbis,
} from '../api-sbis.js';
import SenhaConfirmacao from '../componentes/SenhaConfirmacao.vue';
import {
  type AcaoItemSbis,
  acoesDoItem,
  dataHora,
  faltaParaConcluir,
  FILTROS_ITENS_SBIS,
  type FiltroItensSbis,
  filtrarItensSbis,
  ordenarCiclos,
  pedidoAvaliacao,
  resultadosDoCiclo,
  textoRecusaSbis,
} from '../sbis-tela.js';

const { t } = useI18n();
const qc = useQueryClient();
const podeAvaliar = computed(() => pode(P.sbisAvaliar));

const painel = useQuery({ queryKey: ['sbis', 'painel'], queryFn: () => buscarPainelSbis() });
const ciclos = computed(() => ordenarCiclos(painel.data.value?.ciclos ?? []));

const selecionado = ref<string | null>(null);
const ciclo = useQuery({
  queryKey: computed(() => ['sbis', 'ciclo', selecionado.value]),
  queryFn: () => buscarCicloSbis(selecionado.value as string),
  enabled: computed(() => selecionado.value !== null),
});

const erro = ref<unknown>(null);
const aviso = ref('');
const ocupado = ref(false);
const recusa = computed(() => textoRecusaSbis(codigoDoErro(erro.value)));

async function executar(acao: () => Promise<unknown>, feito: string, depois?: () => void): Promise<void> {
  if (ocupado.value) return;
  ocupado.value = true;
  erro.value = null;
  aviso.value = '';
  try {
    await acao();
    aviso.value = feito;
    depois?.();
    await qc.invalidateQueries({ queryKey: ['sbis'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

// ── abrir ciclo ──────────────────────────────────────────────────────────────────────────────────
const novo = ref<{ tipo: TipoCicloSbis; versao: string; avaliador: string }>({
  tipo: 'autoavaliacao',
  versao: '',
  avaliador: '',
});
const opcoesTipo = computed(() =>
  TIPOS_CICLO_SBIS.map((x) => ({ valor: x, rotulo: t(`sbis.certificacao.ciclos.tipos.${x}`) })),
);
function abrir(): void {
  const n = novo.value;
  void executar(
    () =>
      abrirCicloSbis({
        tipo: n.tipo,
        versao: n.versao.trim(),
        ...(n.avaliador.trim() ? { avaliador: n.avaliador.trim() } : {}),
      }).then((c) => {
        selecionado.value = c.id;
      }),
    t('sbis.certificacao.novo.aberto'),
    () => {
      novo.value = { tipo: 'autoavaliacao', versao: '', avaliador: '' };
    },
  );
}

// ── ações por requisito ──────────────────────────────────────────────────────────────────────────
const alvo = ref<{ item: ItemCicloSbis; acao: AcaoItemSbis } | null>(null);
const avaliacao = ref<{
  resultado: Exclude<ResultadoItemSbis, 'pendente'>;
  severidade: string;
  origem: string;
  evidencia: string;
  observacao: string;
}>({ resultado: 'conforme', severidade: '', origem: '', evidencia: '', observacao: '' });
const descricao = ref('');
const opcoesResultado = computed(() =>
  resultadosDoCiclo(ciclo.data.value?.tipo ?? 'autoavaliacao').map((r) => ({
    valor: r,
    rotulo: t(`sbis.certificacao.ciclo.resultados.${r}`),
  })),
);
const opcoesSeveridade = computed(() =>
  SEVERIDADES_NC_SBIS.map((s) => ({ valor: s, rotulo: t(`sbis.certificacao.ciclo.severidades.${s}`) })),
);
const opcoesOrigem = computed(() =>
  ORIGENS_NC_SBIS.map((s) => ({ valor: s, rotulo: t(`sbis.certificacao.ciclo.origens.${s}`) })),
);

function escolher(item: ItemCicloSbis, acao: AcaoItemSbis): void {
  erro.value = null;
  aviso.value = '';
  if (acao === 'verificar') {
    const id = selecionado.value as string;
    void executar(() => verificarItemSbis(id, item.requisito), t('sbis.certificacao.ciclo.verificado'));
    return;
  }
  alvo.value = { item, acao };
  descricao.value = '';
  const atual = item.resultado === 'pendente' ? 'conforme' : item.resultado;
  avaliacao.value = {
    resultado: resultadosDoCiclo(ciclo.data.value?.tipo ?? 'autoavaliacao').includes(atual)
      ? atual
      : 'conforme',
    severidade: item.severidade ?? '',
    origem: item.origem ?? '',
    evidencia: item.evidencia ?? '',
    observacao: item.observacao ?? '',
  };
}
function salvarAvaliacao(): void {
  if (!alvo.value) return;
  const { item } = alvo.value;
  const id = selecionado.value as string;
  void executar(
    () => avaliarItemSbis(id, item.requisito, pedidoAvaliacao(avaliacao.value) as never),
    t('sbis.certificacao.ciclo.salvo'),
    () => (alvo.value = null),
  );
}
function salvarCorrecao(): void {
  if (!alvo.value) return;
  const { item } = alvo.value;
  const id = selecionado.value as string;
  void executar(
    () => corrigirItemSbis(id, item.requisito, descricao.value.trim()),
    t('sbis.certificacao.ciclo.corrigido'),
    () => (alvo.value = null),
  );
}

// ── concluir e cancelar ──────────────────────────────────────────────────────────────────────────
const parecerTexto = ref('');
const certificado = ref('');
const senha = ref('');
const motivo = ref('');
const pendentes = computed(() => faltaParaConcluir(ciclo.data.value?.itens ?? []) !== null);
// A lista dos requisitos: por padrão, o que ainda pede trabalho (pendentes e não conformes), com busca.
const filtroItens = ref<FiltroItensSbis>('a-tratar');
const buscaItens = ref('');
const opcoesFiltroItens = computed(() =>
  FILTROS_ITENS_SBIS.map((f) => ({ valor: f, rotulo: t(`sbis.certificacao.ciclo.filtros.${f}`) })),
);
const itensVisiveis = computed(() =>
  filtrarItensSbis(ciclo.data.value?.itens ?? [], filtroItens.value, buscaItens.value),
);
function concluir(): void {
  const id = selecionado.value as string;
  const s = senha.value;
  senha.value = '';
  void executar(
    () =>
      concluirCicloSbis(
        id,
        {
          parecerTexto: parecerTexto.value.trim(),
          ...(certificado.value.trim() ? { certificado: certificado.value.trim() } : {}),
        },
        s,
      ),
    t('sbis.certificacao.concluir.concluido'),
    () => {
      parecerTexto.value = '';
      certificado.value = '';
    },
  );
}
function cancelar(): void {
  const id = selecionado.value as string;
  void executar(
    () => cancelarCicloSbis(id, motivo.value.trim()),
    t('sbis.certificacao.cancelamento.cancelado'),
    () => {
      motivo.value = '';
    },
  );
}

const resumo = (c: CicloSbis) =>
  t('sbis.certificacao.ciclos.resumoTexto', {
    conforme: c.resumo.conforme,
    nc: c.resumo['nao-conforme'],
    concessao: c.resumo.concessao,
    pendente: c.resumo.pendente,
    bloqueantes: c.resumo.bloqueantesAbertas,
  });
</script>

<template>
  <section class="tela" aria-labelledby="sbis-titulo">
    <h1 id="sbis-titulo">{{ t('sbis.certificacao.titulo') }}</h1>
    <p>{{ t('sbis.certificacao.texto') }}</p>
    <p>
      <RouterLink to="/administracao/auditoria/trilha" data-testid="sbis-voltar-trilha">
        {{ t('sbis.certificacao.voltarTrilha') }}
      </RouterLink>
    </p>
    <p v-if="!podeAvaliar" data-testid="sbis-sem-edicao">{{ t('sbis.certificacao.semEdicao') }}</p>
    <MensagemErro v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="painel.isPending.value">{{ t('sbis.carregando') }}</p>
    <template v-else-if="painel.data.value">
      <ul class="situacao" data-testid="sbis-situacao">
        <li>{{ t('sbis.certificacao.referencia', { referencia: painel.data.value.referencia }) }}</li>
        <li data-testid="sbis-certificado">
          {{
            painel.data.value.certificado
              ? t('sbis.certificacao.certificado', { numero: painel.data.value.certificado })
              : t('sbis.certificacao.semCertificado')
          }}
        </li>
        <li>
          {{
            painel.data.value.desligado
              ? t('sbis.certificacao.desligado')
              : t('sbis.certificacao.naoDesligado')
          }}
        </li>
        <li data-testid="sbis-auditoria-formal">
          {{
            painel.data.value.auditoriaFormal.pode
              ? t('sbis.certificacao.auditoriaPode')
              : t('sbis.certificacao.auditoriaNao', {
                  motivo: painel.data.value.auditoriaFormal.motivo ?? '',
                })
          }}
        </li>
      </ul>

      <h2>{{ t('sbis.certificacao.requisitos.titulo') }}</h2>
      <p data-testid="sbis-requisitos">
        {{
          t('sbis.certificacao.requisitos.total', {
            n: painel.data.value.requisitos.total,
            fase5: painel.data.value.requisitos.fase5,
          })
        }}
      </p>
      <div class="contagens">
        <dl>
          <dt>{{ t('sbis.certificacao.requisitos.porNivel') }}</dt>
          <dd v-for="n in NIVEIS_SBIS" :key="n">
            {{ t(`sbis.niveis.${n}`) }}: {{ painel.data.value.requisitos.porNivel[n] ?? 0 }}
          </dd>
        </dl>
        <dl>
          <dt>{{ t('sbis.certificacao.requisitos.porRegime') }}</dt>
          <dd v-for="r in REGIMES_SBIS" :key="r">
            {{ t(`sbis.regimes.${r}`) }}: {{ painel.data.value.requisitos.porRegime[r] ?? 0 }}
          </dd>
        </dl>
      </div>

      <h2>{{ t('sbis.certificacao.pacote.titulo') }}</h2>
      <div class="rolagem" tabindex="0" role="region" :aria-label="t('sbis.certificacao.pacote.legenda')">
        <table data-testid="sbis-pacote">
          <caption>
            {{
              t('sbis.certificacao.pacote.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('sbis.certificacao.pacote.item') }}</th>
              <th scope="col">{{ t('sbis.certificacao.pacote.situacao') }}</th>
              <th scope="col">{{ t('sbis.certificacao.pacote.detalhe') }}</th>
              <th scope="col">{{ t('sbis.certificacao.pacote.requisitos') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in painel.data.value.pacote" :key="i.item" :data-testid="`sbis-pacote-${i.item}`">
              <th scope="row">{{ i.titulo }}</th>
              <td>{{ t(`sbis.certificacao.pacote.situacoes.${i.situacao}`) }}</td>
              <td>{{ i.detalhe }}</td>
              <td>{{ i.requisitos.join(', ') || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>{{ t('sbis.certificacao.ciclos.titulo') }}</h2>
      <div class="rolagem" tabindex="0" role="region" :aria-label="t('sbis.certificacao.ciclos.legenda')">
        <table data-testid="sbis-ciclos">
          <caption>
            {{
              t('sbis.certificacao.ciclos.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('sbis.certificacao.ciclos.competencia') }}</th>
              <th scope="col">{{ t('sbis.certificacao.ciclos.tipo') }}</th>
              <th scope="col">{{ t('sbis.certificacao.ciclos.versao') }}</th>
              <th scope="col">{{ t('sbis.certificacao.ciclos.situacao') }}</th>
              <th scope="col">{{ t('sbis.certificacao.ciclos.parecer') }}</th>
              <th scope="col">{{ t('sbis.certificacao.ciclos.resumo') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="ciclos.length === 0">
              <td colspan="6">{{ t('sbis.nenhum') }}</td>
            </tr>
            <tr v-for="c in ciclos" :key="c.id" :data-testid="`sbis-ciclo-${c.id}`">
              <th scope="row">
                <SanteBotao
                  :rotulo="t('sbis.certificacao.ciclos.abrirDetalhe', { competencia: c.competencia })"
                  variante="texto"
                  :data-testid="`sbis-ver-ciclo-${c.id}`"
                  @acionar="selecionado = c.id"
                />
              </th>
              <td>{{ t(`sbis.certificacao.ciclos.tipos.${c.tipo}`) }}</td>
              <td>{{ c.versao }}</td>
              <td>{{ t(`sbis.certificacao.ciclos.situacoes.${c.situacao}`) }}</td>
              <td>{{ c.parecer ? t(`sbis.certificacao.ciclos.pareceres.${c.parecer}`) : '—' }}</td>
              <td>{{ resumo(c) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="sbis-aviso" />
      <SanteAlerta v-if="recusa" :texto="recusa" variante="alerta" anunciar data-testid="sbis-recusa" />
      <MensagemErro v-else-if="erro" :erro="erro" />

      <form v-if="podeAvaliar" class="formulario" data-testid="form-sbis-abrir" @submit.prevent="abrir">
        <h2>{{ t('sbis.certificacao.novo.titulo') }}</h2>
        <SanteSelecao
          id="sbis-novo-tipo"
          v-model="novo.tipo"
          :rotulo="t('sbis.certificacao.novo.tipo')"
          :opcoes="opcoesTipo"
          data-testid="sbis-novo-tipo"
        />
        <div class="campo">
          <label for="sbis-novo-versao">{{ t('sbis.certificacao.novo.versao') }}</label>
          <input
            id="sbis-novo-versao"
            v-model="novo.versao"
            maxlength="40"
            required
            data-testid="sbis-novo-versao"
          />
        </div>
        <div class="campo">
          <label for="sbis-novo-avaliador">{{ t('sbis.certificacao.novo.avaliador') }}</label>
          <input
            id="sbis-novo-avaliador"
            v-model="novo.avaliador"
            maxlength="120"
            aria-describedby="sbis-novo-avaliador-ajuda"
            data-testid="sbis-novo-avaliador"
          />
          <small id="sbis-novo-avaliador-ajuda">{{ t('sbis.certificacao.novo.avaliadorAjuda') }}</small>
        </div>
        <SanteBotao
          :rotulo="t('sbis.certificacao.novo.abrir')"
          tipo="submit"
          :desabilitado="ocupado"
          data-testid="sbis-novo-abrir"
        />
      </form>

      <MensagemErro v-if="selecionado && ciclo.isError.value" :erro="ciclo.error.value" />
      <section
        v-else-if="selecionado && ciclo.data.value"
        class="ciclo"
        aria-labelledby="sbis-ciclo-titulo"
        data-testid="sbis-ciclo"
      >
        <h2 id="sbis-ciclo-titulo">
          {{
            t('sbis.certificacao.ciclo.titulo', {
              tipo: t(`sbis.certificacao.ciclos.tipos.${ciclo.data.value.tipo}`),
              competencia: ciclo.data.value.competencia,
            })
          }}
        </h2>
        <p>
          {{ t(`sbis.certificacao.ciclos.situacoes.${ciclo.data.value.situacao}`) }} ·
          {{
            t('sbis.certificacao.ciclo.abertoPor', {
              por: ciclo.data.value.abertoPor,
              em: dataHora(ciclo.data.value.abertoEm),
            })
          }}
          <span v-if="ciclo.data.value.avaliador">
            · {{ t('sbis.certificacao.ciclo.avaliador', { avaliador: ciclo.data.value.avaliador }) }}
          </span>
          <span v-if="ciclo.data.value.concluidoPor">
            ·
            {{
              t('sbis.certificacao.ciclo.concluidoPor', {
                por: ciclo.data.value.concluidoPor,
                em: dataHora(ciclo.data.value.concluidoEm),
              })
            }}
          </span>
        </p>
        <p v-if="ciclo.data.value.parecerTexto" data-testid="sbis-ciclo-parecer">
          {{ ciclo.data.value.parecerTexto }}
        </p>
        <div class="filtros-itens" data-testid="sbis-itens-filtros">
          <SanteSelecao
            id="sbis-itens-filtro"
            v-model="filtroItens"
            :rotulo="t('sbis.certificacao.ciclo.filtro')"
            :opcoes="opcoesFiltroItens"
            data-testid="sbis-itens-filtro"
          />
          <div class="campo">
            <label for="sbis-itens-busca">{{ t('sbis.certificacao.ciclo.busca') }}</label>
            <input
              id="sbis-itens-busca"
              v-model="buscaItens"
              type="search"
              maxlength="80"
              data-testid="sbis-itens-busca"
            />
          </div>
          <p aria-live="polite" data-testid="sbis-itens-exibindo">
            {{
              t('sbis.certificacao.ciclo.exibindo', {
                n: itensVisiveis.length,
                total: ciclo.data.value.itens.length,
              })
            }}
          </p>
        </div>
        <div class="rolagem" tabindex="0" role="region" :aria-label="t('sbis.certificacao.ciclo.legenda')">
          <table data-testid="sbis-itens">
            <caption>
              {{
                t('sbis.certificacao.ciclo.legenda')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('sbis.certificacao.ciclo.requisito') }}</th>
                <th scope="col">{{ t('sbis.certificacao.ciclo.nivel') }}</th>
                <th scope="col">{{ t('sbis.certificacao.ciclo.resultado') }}</th>
                <th scope="col">{{ t('sbis.certificacao.ciclo.evidencia') }}</th>
                <th scope="col">{{ t('sbis.certificacao.ciclo.correcao') }}</th>
                <th scope="col">{{ t('sbis.certificacao.ciclo.acoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="itensVisiveis.length === 0" data-testid="sbis-itens-nenhum">
                <td colspan="6">{{ t('sbis.certificacao.ciclo.nenhum') }}</td>
              </tr>
              <tr v-for="i in itensVisiveis" :key="i.requisito" :data-testid="`sbis-item-${i.requisito}`">
                <th scope="row">{{ i.requisito }} · {{ i.titulo }}</th>
                <td>{{ t(`sbis.niveis.${i.nivel}`) }}</td>
                <td>
                  {{ t(`sbis.certificacao.ciclo.resultados.${i.resultado}`) }}
                  <span v-if="i.severidade">
                    ({{ t(`sbis.certificacao.ciclo.severidades.${i.severidade}`)
                    }}<span v-if="i.origem">, {{ t(`sbis.certificacao.ciclo.origens.${i.origem}`) }}</span
                    >)
                  </span>
                </td>
                <td>{{ i.evidencia ?? i.observacao ?? '—' }}</td>
                <td>
                  <template v-if="i.correcao">
                    {{ t(`sbis.certificacao.ciclo.correcoes.${i.correcao}`) }}
                    <span v-if="i.corrigidoPor">
                      · {{ t('sbis.certificacao.ciclo.corrigidoPor', { por: i.corrigidoPor }) }}</span
                    >
                    <span v-if="i.verificadoPor">
                      · {{ t('sbis.certificacao.ciclo.verificadoPor', { por: i.verificadoPor }) }}</span
                    >
                  </template>
                  <template v-else>—</template>
                </td>
                <td class="acoes">
                  <SanteBotao
                    v-for="a in acoesDoItem(i, ciclo.data.value, podeAvaliar)"
                    :key="a"
                    :rotulo="t(`sbis.certificacao.ciclo.${a}`, { requisito: i.requisito })"
                    variante="texto"
                    :desabilitado="ocupado"
                    :data-testid="`sbis-${a}-${i.requisito}`"
                    @acionar="escolher(i, a)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <form
          v-if="alvo && alvo.acao === 'avaliar'"
          class="formulario"
          data-testid="form-sbis-avaliar"
          @submit.prevent="salvarAvaliacao"
        >
          <h3>
            {{
              t('sbis.certificacao.avaliacao.titulo', {
                requisito: alvo.item.requisito,
                titulo: alvo.item.titulo,
              })
            }}
          </h3>
          <SanteSelecao
            id="sbis-avaliar-resultado"
            v-model="avaliacao.resultado"
            :rotulo="t('sbis.certificacao.avaliacao.resultado')"
            :opcoes="opcoesResultado"
            data-testid="sbis-avaliar-resultado"
          />
          <template v-if="avaliacao.resultado === 'nao-conforme'">
            <SanteSelecao
              id="sbis-avaliar-severidade"
              v-model="avaliacao.severidade"
              :rotulo="t('sbis.certificacao.avaliacao.severidade')"
              :opcoes="opcoesSeveridade"
              obrigatorio
              data-testid="sbis-avaliar-severidade"
            />
            <SanteSelecao
              id="sbis-avaliar-origem"
              v-model="avaliacao.origem"
              :rotulo="t('sbis.certificacao.avaliacao.origem')"
              :opcoes="opcoesOrigem"
              obrigatorio
              data-testid="sbis-avaliar-origem"
            />
          </template>
          <div class="campo">
            <label for="sbis-avaliar-evidencia">{{ t('sbis.certificacao.avaliacao.evidencia') }}</label>
            <textarea
              id="sbis-avaliar-evidencia"
              v-model="avaliacao.evidencia"
              maxlength="500"
              rows="2"
              aria-describedby="sbis-avaliar-evidencia-ajuda"
              data-testid="sbis-avaliar-evidencia"
            />
            <small id="sbis-avaliar-evidencia-ajuda">{{
              t('sbis.certificacao.avaliacao.evidenciaAjuda')
            }}</small>
          </div>
          <div class="campo">
            <label for="sbis-avaliar-observacao">{{ t('sbis.certificacao.avaliacao.observacao') }}</label>
            <textarea
              id="sbis-avaliar-observacao"
              v-model="avaliacao.observacao"
              maxlength="500"
              rows="2"
              aria-describedby="sbis-avaliar-observacao-ajuda"
              data-testid="sbis-avaliar-observacao"
            />
            <small id="sbis-avaliar-observacao-ajuda">{{
              t('sbis.certificacao.avaliacao.observacaoAjuda')
            }}</small>
          </div>
          <div class="botoes">
            <SanteBotao
              :rotulo="t('sbis.certificacao.avaliacao.salvar')"
              tipo="submit"
              :desabilitado="ocupado"
              data-testid="sbis-avaliar-salvar"
            />
            <SanteBotao :rotulo="t('sbis.cancelar')" variante="texto" @acionar="alvo = null" />
          </div>
        </form>

        <form
          v-if="alvo && alvo.acao === 'corrigir'"
          class="formulario"
          data-testid="form-sbis-corrigir"
          @submit.prevent="salvarCorrecao"
        >
          <h3>{{ t('sbis.certificacao.correcao.titulo', { requisito: alvo.item.requisito }) }}</h3>
          <div class="campo">
            <label for="sbis-corrigir-descricao">{{ t('sbis.certificacao.correcao.descricao') }}</label>
            <textarea
              id="sbis-corrigir-descricao"
              v-model="descricao"
              maxlength="500"
              minlength="10"
              rows="3"
              required
              data-testid="sbis-corrigir-descricao"
            />
          </div>
          <div class="botoes">
            <SanteBotao
              :rotulo="t('sbis.certificacao.correcao.salvar')"
              tipo="submit"
              :desabilitado="ocupado"
              data-testid="sbis-corrigir-salvar"
            />
            <SanteBotao :rotulo="t('sbis.cancelar')" variante="texto" @acionar="alvo = null" />
          </div>
        </form>

        <template v-if="podeAvaliar && ciclo.data.value.situacao === 'aberto'">
          <form class="formulario" data-testid="form-sbis-concluir" @submit.prevent="concluir">
            <h3>{{ t('sbis.certificacao.concluir.titulo') }}</h3>
            <p v-if="pendentes" data-testid="sbis-pendentes">
              {{ t('sbis.certificacao.concluir.pendentes') }}
            </p>
            <div class="campo">
              <label for="sbis-concluir-parecer">{{ t('sbis.certificacao.concluir.parecer') }}</label>
              <textarea
                id="sbis-concluir-parecer"
                v-model="parecerTexto"
                maxlength="1000"
                minlength="10"
                rows="3"
                required
                aria-describedby="sbis-concluir-parecer-ajuda"
                data-testid="sbis-concluir-parecer"
              />
              <small id="sbis-concluir-parecer-ajuda">{{
                t('sbis.certificacao.concluir.parecerAjuda')
              }}</small>
            </div>
            <div v-if="ciclo.data.value.tipo === 'auditoria'" class="campo">
              <label for="sbis-concluir-certificado">{{ t('sbis.certificacao.concluir.certificado') }}</label>
              <input
                id="sbis-concluir-certificado"
                v-model="certificado"
                maxlength="40"
                aria-describedby="sbis-concluir-certificado-ajuda"
                data-testid="sbis-concluir-certificado"
              />
              <small id="sbis-concluir-certificado-ajuda">{{
                t('sbis.certificacao.concluir.certificadoAjuda')
              }}</small>
            </div>
            <SenhaConfirmacao v-model="senha" testid="sbis-concluir-senha" />
            <SanteBotao
              :rotulo="t('sbis.certificacao.concluir.concluir')"
              tipo="submit"
              :desabilitado="ocupado || pendentes"
              data-testid="sbis-concluir"
            />
          </form>
          <form class="formulario" data-testid="form-sbis-cancelar" @submit.prevent="cancelar">
            <h3>{{ t('sbis.certificacao.cancelamento.titulo') }}</h3>
            <div class="campo">
              <label for="sbis-cancelar-motivo">{{ t('sbis.certificacao.cancelamento.motivo') }}</label>
              <input
                id="sbis-cancelar-motivo"
                v-model="motivo"
                maxlength="200"
                minlength="5"
                required
                data-testid="sbis-cancelar-motivo"
              />
            </div>
            <SanteBotao
              :rotulo="t('sbis.certificacao.cancelamento.cancelar')"
              tipo="submit"
              variante="secundario"
              :desabilitado="ocupado"
              data-testid="sbis-cancelar"
            />
          </form>
        </template>
      </section>
    </template>
  </section>
</template>

<style scoped>
.situacao {
  margin: var(--sgh-espaco-2) 0;
}
.contagens {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-4);
}
dt {
  font-weight: 600;
}
dd {
  margin: 0;
}
.formulario {
  display: grid;
  gap: var(--sgh-espaco-2);
  max-width: 40rem;
  margin: var(--sgh-espaco-3) 0;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.filtros-itens {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: end;
}
.botoes,
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
.rolagem {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
}
caption {
  text-align: left;
  font-weight: 600;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
  vertical-align: top;
}
input,
textarea {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
small {
  color: var(--sgh-texto-secundario);
}
</style>
