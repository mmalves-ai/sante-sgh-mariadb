<script setup lang="ts">
// Migração gradual: prontidão do desligamento por hospital (M58, etapa 1; ficha, seções 7, 8 e 12). No estabelecimento
// ativo: as pessoas que ainda usam o outro sistema (pela tabela de conexões e pela medida diária; contas combinadas
// fora), o inventário do que sai com o substituto ou o aceite da área e a contingência, as contas técnicas do banco
// com o destino, e os três passos (desligar, motor 5, UTF-8) com o que falta. Registrar um item é do responsável da
// área, com a senha de novo. Nada aqui desliga coisa alguma: o outro sistema segue ligado até a decisão do dono.
import {
  CONTINGENCIAS_DESLIGAMENTO,
  type ContingenciaDesligamento,
  type ItemDesligamentoAvaliado,
  type PainelDesligamento,
  SITUACOES_ITEM_DESLIGAMENTO,
  type SituacaoItemDesligamento,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { pode } from '../../../casca/sessao/pode.js';
import { lerDesligamento, registrarItemDesligamento, voltarDesligamentoPendente } from '../api.js';
import AbasMigracao from '../componentes/AbasMigracao.vue';
import AcaoCicloDialogo from '../componentes/AcaoCicloDialogo.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const consulta = useQuery({ queryKey: ['coexistencia', 'desligamento'], queryFn: lerDesligamento });
const painel = computed<PainelDesligamento | undefined>(() => consulta.data.value);
const podeRegistrar = computed(() => painel.value?.podeRegistrar === true);
// W0-09: voltar o item registrado a 'pendente' (fato novo com motivo e a senha de novo; o anterior fica na história).
const voltando = ref<string | null>(null);
const dialogoVoltar = ref(false);
function abrirVoltar(item: string): void {
  voltando.value = item;
  dialogoVoltar.value = true;
}
const executarVoltar = (motivo: string, senha: string) =>
  voltando.value ? voltarDesligamentoPendente(voltando.value, motivo, senha) : Promise.resolve(null);
const voltou = () => cliente.invalidateQueries({ queryKey: ['coexistencia', 'desligamento'] });
const podeVerPlataforma = computed(() => pode('config.schema.ler'));
const dia = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
const instante = (d: string) => new Date(d).toLocaleString('pt-BR');
const tituloItem = (id: string) => t(`desligamento.inventario.itens.${id}.titulo`);

// O outro sistema continua ligado enquanto nenhum passo estiver autorizado ou executado (DP-6 no padrão).
const padraoAtual = computed(
  () =>
    painel.value?.passos.every((p) => p.situacao === 'bloqueado' || p.situacao === 'pronto-para-autorizar') ??
    false,
);
const maiorDia = computed(() => Math.max(1, ...(painel.value?.sessoes.porDia.map((x) => x.pessoas) ?? [1])));

function substituto(i: ItemDesligamentoAvaliado): string {
  if (!i.substituto) return t('desligamento.inventario.semSubstituto');
  const base = i.substituto.itemMenu
    ? t('desligamento.inventario.marco', { marco: i.substituto.marco })
    : `${t('desligamento.inventario.substitutoSistema')} · ${t('desligamento.inventario.marco', { marco: i.substituto.marco })}`;
  return i.substituto.aConfirmar ? `${base} · ${t('desligamento.inventario.aConfirmar')}` : base;
}

// ── Registro de um item (regra 2) ───────────────────────────────────────────────────────────────────────
const aberto = ref<string | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
// A recusa de negócio (409) mostra o motivo do servidor (substituto inexistente ou a confirmar).
const recusa = ref<string | null>(null);
const form = reactive({
  item: '' as string,
  situacao: 'aceito-como-perdido' as SituacaoItemDesligamento,
  contingencia: 'reinstalavel-no-periodo' as ContingenciaDesligamento,
  papel: '',
  evidencia: '',
  senha: '',
});
const opcoesItem = computed(() =>
  (painel.value?.itens ?? []).map((i) => ({ valor: i.item, rotulo: tituloItem(i.item) })),
);
const opcoesSituacao = computed(() =>
  SITUACOES_ITEM_DESLIGAMENTO.filter((s) => s !== 'pendente').map((s) => ({
    valor: s,
    rotulo: t(`desligamento.inventario.situacoes.${s}`),
  })),
);
const opcoesContingencia = computed(() =>
  CONTINGENCIAS_DESLIGAMENTO.map((c) => ({
    valor: c,
    rotulo: t(`desligamento.inventario.contingencias.${c}`),
  })),
);

function abrir(item: string): void {
  const atual = painel.value?.itens.find((i) => i.item === item);
  aberto.value = item;
  form.item = item;
  form.situacao = atual && atual.situacao !== 'pendente' ? atual.situacao : 'aceito-como-perdido';
  form.contingencia = atual?.contingencia ?? 'reinstalavel-no-periodo';
  form.papel = atual?.papelResponsavel ?? '';
  form.evidencia = atual?.evidencia ?? '';
  form.senha = '';
  mensagem.value = null;
  erro.value = null;
  recusa.value = null;
}

async function registrar(): Promise<void> {
  if (!form.item) return;
  erro.value = null;
  mensagem.value = null;
  recusa.value = null;
  if (form.situacao === 'pendente') {
    mensagem.value = t('desligamento.registrar.erroPendente');
    return;
  }
  try {
    await registrarItemDesligamento(
      {
        item: form.item,
        situacao: form.situacao,
        contingencia: form.contingencia,
        papelResponsavel: form.papel,
        evidencia: form.evidencia,
      },
      form.senha,
    );
    form.senha = '';
    aberto.value = null;
    mensagem.value = t('desligamento.registrar.gravado');
    await cliente.invalidateQueries({ queryKey: ['coexistencia', 'desligamento'] });
  } catch (e) {
    form.senha = '';
    if (e instanceof ErroApi && e.status === 409 && e.problema?.detail) recusa.value = e.problema.detail;
    else erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="titulo-desligamento" data-testid="tela-desligamento">
    <h1 id="titulo-desligamento">{{ t('desligamento.prontidao.titulo') }}</h1>
    <AbasMigracao atual="desligamento" />
    <p>{{ t('desligamento.prontidao.descricao') }}</p>
    <MensagemErro v-if="consulta.error.value" :erro="consulta.error.value" />
    <p v-else-if="!painel" role="status">{{ t('coexistencia.carregando') }}</p>
    <template v-else>
      <p data-testid="desligamento-em">
        {{ t('desligamento.prontidao.atualizadoEm', { em: instante(painel.em) }) }}
      </p>
      <SanteAlerta
        v-if="padraoAtual"
        :texto="t('desligamento.prontidao.padraoAtual')"
        variante="info"
        data-testid="desligamento-padrao"
      />
      <SanteAlerta
        v-if="painel.registroInvalido"
        :texto="t('desligamento.prontidao.registroInvalido', { motivo: painel.registroInvalido })"
        variante="aviso"
        data-testid="desligamento-registro-invalido"
      />
      <ul data-testid="desligamento-decisoes">
        <li>
          {{
            painel.fimRegistradoEm
              ? t('desligamento.prontidao.fimRegistrado', { data: dia(painel.fimRegistradoEm) })
              : t('desligamento.prontidao.fimNaoRegistrado')
          }}
        </li>
        <li data-testid="desligamento-dp6">
          <template v-if="painel.dp6.decididaEm">{{
            t('desligamento.prontidao.dp6Decidida', { data: dia(painel.dp6.decididaEm) })
          }}</template>
          <template v-else-if="painel.dp6.previstaPara">{{
            t('desligamento.prontidao.dp6Prevista', { data: dia(painel.dp6.previstaPara) })
          }}</template>
          <template v-else>{{ t('desligamento.prontidao.dp6Pendente') }}</template>
        </li>
        <li>{{ t('desligamento.prontidao.registro', { caminho: painel.registro }) }}</li>
      </ul>

      <!-- Passos -->
      <section aria-labelledby="desligamento-passos" data-testid="desligamento-passos">
        <h2 id="desligamento-passos">{{ t('desligamento.passos.titulo') }}</h2>
        <ol>
          <li v-for="p in painel.passos" :key="p.passo" :data-testid="`passo-${p.passo}`">
            <strong>{{ t(`desligamento.passos.nomes.${p.passo}`) }}</strong>
            ({{ t('desligamento.passos.fatia', { fatia: p.fatia }) }}):
            <span data-testid="situacao">{{ t(`desligamento.passos.situacoes.${p.situacao}`) }}</span>
            <ul v-if="p.motivos.length">
              <li v-for="m in p.motivos" :key="m" :data-testid="`motivo-${m}`">
                {{ t(`desligamento.passos.motivos.${m}`) }}
              </li>
            </ul>
          </li>
        </ol>
      </section>

      <!-- Sessões (regra 3) -->
      <section aria-labelledby="desligamento-sessoes" data-testid="desligamento-sessoes">
        <h2 id="desligamento-sessoes">{{ t('desligamento.sessoes.titulo') }}</h2>
        <p data-testid="sessoes-criterio">
          <strong>{{ t('desligamento.sessoes.criterioFinal') }}:</strong>
          {{
            painel.sessoesCumprido
              ? t('desligamento.sessoes.cumprido')
              : t('desligamento.sessoes.naoCumprido')
          }}
        </p>
        <ul>
          <li data-testid="sessoes-tabela">
            {{
              t('desligamento.sessoes.tabela', {
                situacao: painel.sessoes.cumprido
                  ? t('desligamento.sessoes.cumpridoCurto')
                  : t('desligamento.sessoes.naoCumpridoCurto'),
              })
            }}
            · {{ t('desligamento.sessoes.janela', { dias: painel.sessoes.janelaDias }) }}:
            <span data-testid="sessoes-pessoas">{{
              t('desligamento.sessoes.pessoas', { n: painel.sessoes.pessoasNaJanela })
            }}</span>
            ·
            {{
              painel.sessoes.diasSemSessao === null
                ? t('desligamento.sessoes.nenhumUso')
                : t('desligamento.sessoes.diasSem', { n: painel.sessoes.diasSemSessao })
            }}
          </li>
          <li>
            {{
              t('desligamento.sessoes.cap14', {
                situacao: painel.sessoes.cumpridoCap14
                  ? t('desligamento.sessoes.cumpridoCurto')
                  : t('desligamento.sessoes.naoCumpridoCurto'),
              })
            }}
          </li>
          <li data-testid="sessoes-medida">
            {{
              t('desligamento.sessoes.medida', {
                n: painel.medidaDiaria.diasLimpos,
                exigidos: painel.medidaDiaria.exigidos,
              })
            }}
            <template v-if="painel.medidaDiaria.paradaSemMedida">
              · {{ t('desligamento.sessoes.semMedida', { dia: dia(painel.medidaDiaria.paradaSemMedida) }) }}
            </template>
            <template v-if="painel.medidaDiaria.ultimaSessao">
              · {{ t('desligamento.sessoes.ultimaSessao', { dia: dia(painel.medidaDiaria.ultimaSessao) }) }}
            </template>
          </li>
          <li>
            {{
              t('desligamento.sessoes.ultimoDiaTabela', {
                dia: painel.ultimoDiaTabela ? dia(painel.ultimoDiaTabela) : t('desligamento.sessoes.semDia'),
              })
            }}
          </li>
          <li data-testid="sessoes-combinadas">
            {{ t('desligamento.sessoes.combinadas', { n: painel.contasCombinadas }) }}
          </li>
        </ul>
        <p>{{ t('desligamento.sessoes.nota') }}</p>
        <table v-if="painel.sessoes.porDia.length" class="tabela" data-testid="sessoes-serie">
          <caption>
            {{
              t('desligamento.sessoes.serie')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('desligamento.sessoes.colunas.dia') }}</th>
              <th scope="col">{{ t('desligamento.sessoes.colunas.pessoas') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in painel.sessoes.porDia" :key="x.dia">
              <th scope="row">{{ dia(x.dia) }}</th>
              <td>
                <span
                  class="barra"
                  :style="{ width: `${Math.round((x.pessoas / maiorDia) * 100)}%` }"
                  aria-hidden="true"
                />
                {{ x.pessoas }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Inventário (regra 2) -->
      <section aria-labelledby="desligamento-inventario" data-testid="desligamento-inventario">
        <h2 id="desligamento-inventario">{{ t('desligamento.inventario.titulo') }}</h2>
        <p>{{ t('desligamento.inventario.descricao') }}</p>
        <div class="rolagem">
          <table class="tabela">
            <caption>
              {{
                t('desligamento.inventario.titulo')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('desligamento.inventario.colunas.item') }}</th>
                <th scope="col">{{ t('desligamento.inventario.colunas.tipo') }}</th>
                <th scope="col">{{ t('desligamento.inventario.colunas.area') }}</th>
                <th scope="col">{{ t('desligamento.inventario.colunas.substituto') }}</th>
                <th scope="col">{{ t('desligamento.inventario.colunas.situacao') }}</th>
                <th scope="col">{{ t('desligamento.inventario.colunas.contingencia') }}</th>
                <th scope="col">{{ t('desligamento.inventario.colunas.pendencias') }}</th>
                <th v-if="podeRegistrar" scope="col">
                  <span class="visualmente-oculto">{{ t('desligamento.inventario.registrar') }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="i in painel.itens" :key="i.item" :data-testid="`item-${i.item}`">
                <th scope="row">
                  {{ tituloItem(i.item) }}
                  <small>{{ t(`desligamento.inventario.itens.${i.item}.descricao`) }}</small>
                </th>
                <td>{{ t(`desligamento.inventario.tipos.${i.tipo}`) }}</td>
                <td>{{ i.areaResponsavel }}</td>
                <td>{{ substituto(i) }}</td>
                <td data-testid="situacao">
                  {{ t(`desligamento.inventario.situacoes.${i.situacao}`) }}
                  <small v-if="i.registradoEm">{{
                    t('desligamento.inventario.registradoEm', {
                      em: instante(i.registradoEm),
                      papel: i.papelResponsavel ?? '—',
                    })
                  }}</small>
                  <small v-if="i.evidencia">{{
                    t('desligamento.inventario.evidencia', { evidencia: i.evidencia })
                  }}</small>
                </td>
                <td data-testid="contingencia">
                  {{
                    i.contingencia
                      ? t(`desligamento.inventario.contingencias.${i.contingencia}`)
                      : t('desligamento.inventario.nenhuma')
                  }}
                </td>
                <td data-testid="pendencias">
                  <ul v-if="i.pendencias.length">
                    <li v-for="p in i.pendencias" :key="p">
                      {{ t(`desligamento.inventario.pendencias.${p}`) }}
                    </li>
                  </ul>
                  <template v-else>—</template>
                </td>
                <td v-if="podeRegistrar">
                  <SanteBotao
                    :rotulo="`${t('desligamento.inventario.registrar')}: ${tituloItem(i.item)}`"
                    variante="secundario"
                    :data-testid="`registrar-${i.item}`"
                    @acionar="abrir(i.item)"
                  />
                  <SanteBotao
                    v-if="i.situacao !== 'pendente'"
                    :rotulo="t('coexistencia.ciclo.voltarPendente')"
                    variante="texto"
                    :data-testid="`voltar-pendente-${i.item}`"
                    @acionar="abrirVoltar(i.item)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <AcaoCicloDialogo
        v-model:visivel="dialogoVoltar"
        :titulo="t('coexistencia.ciclo.voltarPendenteTitulo', { item: voltando ? tituloItem(voltando) : '' })"
        :texto="t('coexistencia.ciclo.voltarDesligamentoTexto')"
        :rotulo="t('coexistencia.ciclo.voltarPendente')"
        com-senha
        :executar="executarVoltar"
        @feito="voltou"
      />
      <section
        v-if="aberto && podeRegistrar"
        aria-labelledby="titulo-registrar-item"
        data-testid="form-desligamento"
      >
        <h2 id="titulo-registrar-item">
          {{ t('desligamento.registrar.registrarDe', { item: tituloItem(aberto) }) }}
        </h2>
        <p>{{ t('desligamento.registrar.explicacao') }}</p>
        <form class="filtros" @submit.prevent="registrar">
          <SanteSelecao
            id="desligamento-item"
            v-model="form.item"
            :rotulo="t('desligamento.registrar.item')"
            :opcoes="opcoesItem"
            obrigatorio
            busca
            data-testid="desligamento-item"
          />
          <SanteSelecao
            id="desligamento-situacao"
            v-model="form.situacao"
            :rotulo="t('desligamento.registrar.situacao')"
            :opcoes="opcoesSituacao"
            obrigatorio
            busca
            data-testid="desligamento-situacao"
          />
          <SanteSelecao
            id="desligamento-contingencia"
            v-model="form.contingencia"
            :rotulo="t('desligamento.registrar.contingencia')"
            :opcoes="opcoesContingencia"
            obrigatorio
            busca
            data-testid="desligamento-contingencia"
          />
          <SanteCampoTexto
            v-model="form.papel"
            :rotulo="t('desligamento.registrar.papel')"
            :max-bytes="60"
            obrigatorio
            data-testid="desligamento-papel"
          />
          <SanteCampoTexto
            v-model="form.evidencia"
            :rotulo="t('desligamento.registrar.evidencia')"
            :max-bytes="200"
            obrigatorio
            data-testid="desligamento-evidencia"
          />
          <div class="campo">
            <label for="desligamento-senha">{{ t('desligamento.registrar.senha') }}</label>
            <input
              id="desligamento-senha"
              v-model="form.senha"
              type="password"
              autocomplete="current-password"
              required
              data-testid="desligamento-senha"
            />
          </div>
          <SanteBotao
            :rotulo="t('desligamento.registrar.gravar')"
            variante="primario"
            tipo="submit"
            data-testid="desligamento-gravar"
          />
          <SanteBotao
            :rotulo="t('desligamento.registrar.cancelar')"
            variante="secundario"
            data-testid="desligamento-cancelar"
            @acionar="aberto = null"
          />
        </form>
      </section>
      <SanteAlerta
        v-if="mensagem"
        :texto="mensagem"
        variante="info"
        anunciar
        data-testid="desligamento-mensagem"
      />
      <SanteAlerta
        v-if="recusa"
        :texto="recusa"
        variante="aviso"
        anunciar
        data-testid="desligamento-recusa"
      />
      <MensagemErro v-if="erro" :erro="erro" />

      <!-- Contas técnicas -->
      <section aria-labelledby="desligamento-contas" data-testid="desligamento-contas">
        <h2 id="desligamento-contas">{{ t('desligamento.contas.titulo') }}</h2>
        <p>{{ t('desligamento.contas.descricao') }}</p>
        <SanteAlerta
          v-if="painel.contas.naoDeclaradas > 0"
          :texto="t('desligamento.contas.naoDeclaradas', { n: painel.contas.naoDeclaradas })"
          variante="aviso"
          data-testid="contas-nao-declaradas"
        />
        <div class="rolagem">
          <table class="tabela">
            <caption>
              {{
                t('desligamento.contas.titulo')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('desligamento.contas.colunas.conta') }}</th>
                <th scope="col">{{ t('desligamento.contas.colunas.destino') }}</th>
                <th scope="col">{{ t('desligamento.contas.colunas.presente') }}</th>
                <th scope="col">{{ t('desligamento.contas.colunas.escrita') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in painel.contas.declaradas" :key="c.conta" :data-testid="`conta-${c.conta}`">
                <th scope="row">
                  <code>{{ c.conta }}</code>
                </th>
                <td>{{ t(`desligamento.contas.destinos.${c.destino}`) }}</td>
                <td>{{ c.presente ? t('coexistencia.sim') : t('coexistencia.nao') }}</td>
                <td>{{ c.escrita ? t('coexistencia.sim') : t('coexistencia.nao') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <p v-if="podeVerPlataforma">
        <RouterLink to="/administracao/coexistencia/schema" data-testid="ir-plataforma">{{
          t('desligamento.prontidao.verPlataforma')
        }}</RouterLink>
      </p>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.rolagem {
  overflow-x: auto;
}
.barra {
  display: inline-block;
  height: 0.75em;
  margin-right: var(--sgh-espaco-1);
  background: currentcolor;
  opacity: 0.4;
}
small {
  display: block;
}
.visualmente-oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
