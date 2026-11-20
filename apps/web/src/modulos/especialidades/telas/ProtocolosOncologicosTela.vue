<script setup lang="ts">
// Protocolos de quimioterapia (ficha do M45, seção 7; mina, regra 19; DP-32): `/pep/especialidades/oncologia/protocolos`.
// As versões publicadas (imutáveis; a vigente é a mais nova do código; a íntegra confere o hash) e a publicação pelo
// médico: corrigir é publicar a versão seguinte do mesmo código, a partir da vigente.
// W0-05: a situação de cada versão (vigente, substituída, revogada; o protocolo inativo; oferecida ou não a ciclos
// novos) e o ciclo de vida pelo diálogo de correção, com o motivo: revogar a versão (crítico: a lista dos ciclos que a
// usam, a ciência quando há ciclos em andamento e a senha de novo), inativar o protocolo (crítico, senha) e reativar.
// Nada se exclui: os ciclos continuam com a versão deles. A impressão sai com as versões revogadas e os eventos.
// W0-05 (revisão): o cartão do catálogo e as abas (Oferecidos; Fora da oferta: substituídas, revogadas e do protocolo
// inativo; Publicar), como a ficha do profissional; a impressão junta as duas listas.
import {
  type DependenciasProtocolo,
  type EventoOncoLido,
  type FarmacoProtocolo,
  type ProtocoloOncologicoLido,
  UNIDADES_DOSE_ONCO,
  type UnidadeDoseOnco,
  VIAS_ONCO,
  type ViaOnco,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AbasFicha from '../../nutricao/componentes/AbasFicha.vue';
import CartaoPerfil from '../../nutricao/componentes/CartaoPerfil.vue';
import DialogoCorrecao from '../../nutricao/componentes/DialogoCorrecao.vue';
import {
  lerDependenciasProtocolo,
  lerGravacaoEspecialidade,
  lerProtocolos,
  mudarProtocolo,
  novaChaveEspecialidade,
  publicarProtocolo,
  revogarVersaoProtocolo,
} from '../api-especialidades.js';
import AvisoEspecialidade from '../componentes/AvisoEspecialidade.vue';
import ErroEspecialidade from '../componentes/ErroEspecialidade.vue';
import { dataLonga, diasDoTexto, instanteCurto, numero } from '../regras-especialidades.js';

const { t } = useI18n();
const gravacao = useQuery({
  queryKey: ['especialidades', 'oncologia', 'gravacao'],
  queryFn: () => lerGravacaoEspecialidade('oncologia'),
  staleTime: 30_000,
});
const pode = computed(() => gravacao.data.value?.operacoes['publicar']?.pode ?? false);
const motivoPode = computed(() => gravacao.data.value?.operacoes['publicar']?.motivo ?? null);
const aviso = computed(() =>
  gravacao.data.value && !gravacao.data.value.ligada ? gravacao.data.value.motivo : null,
);
const dados = useQuery({ queryKey: ['especialidades', 'oncologia', 'protocolos'], queryFn: lerProtocolos });
const tipos = computed(() =>
  (dados.data.value?.tipos ?? []).map((x) => ({ valor: x.codigo, rotulo: x.nome })),
);
const unidades = UNIDADES_DOSE_ONCO.map((u) => ({ valor: u.codigo, rotulo: u.rotulo }));
const vias = VIAS_ONCO.map((v) => ({ valor: v.codigo, rotulo: v.rotulo }));

interface FarmacoForm {
  nome: string;
  dose: string;
  unidade: UnidadeDoseOnco;
  via: ViaOnco;
  dias: string;
  administracao: string;
}
const novoFarmaco = (): FarmacoForm => ({
  nome: '',
  dose: '',
  unidade: 'mg/m2',
  via: 'iv',
  dias: '1',
  administracao: '',
});
const codigo = ref('');
const nome = ref('');
const tipo = ref<number | null>(null);
const intervalo = ref('21');
const ciclos = ref('6');
const indicacao = ref('');
const referencia = ref('');
const farmacos = ref<FarmacoForm[]>([novoFarmaco()]);

const unidadeTexto = (u: string) => UNIDADES_DOSE_ONCO.find((x) => x.codigo === u)?.rotulo ?? u;
const viaTexto = (v: string) => VIAS_ONCO.find((x) => x.codigo === v)?.rotulo ?? v;

// A aba (Oferecidos; Fora da oferta; Publicar): "Nova versão" leva ao formulário; a publicação, de volta à lista.
const aba = ref('oferecidos');
function aPartirDe(p: ProtocoloOncologicoLido): void {
  aba.value = 'publicar';
  codigo.value = p.codigo;
  nome.value = p.nome;
  tipo.value = p.tipo.codigo;
  intervalo.value = String(p.intervaloDias);
  ciclos.value = String(p.ciclos);
  indicacao.value = p.indicacao ?? '';
  referencia.value = p.referencia;
  farmacos.value = p.farmacos.map((f: FarmacoProtocolo) => ({
    nome: f.nome,
    dose: String(f.dose).replace('.', ','),
    unidade: f.unidade,
    via: f.via,
    dias: f.dias.join(', '),
    administracao: f.administracao ?? '',
  }));
}

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function publicar(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await publicarProtocolo(
      {
        codigo: codigo.value,
        nome: nome.value,
        tipo: tipo.value,
        intervaloDias: Number(intervalo.value),
        ciclos: Number(ciclos.value),
        farmacos: farmacos.value.map((f) => ({
          nome: f.nome,
          dose: Number(f.dose.replace(',', '.')),
          unidade: f.unidade,
          via: f.via,
          dias: diasDoTexto(f.dias),
          ...(f.administracao.trim() ? { administracao: f.administracao.trim() } : {}),
        })),
        ...(indicacao.value.trim() ? { indicacao: indicacao.value.trim() } : {}),
        referencia: referencia.value,
      },
      novaChaveEspecialidade('protocolo'),
    );
    mensagem.value = r.mensagem;
    await dados.refetch();
    aba.value = 'oferecidos';
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── W0-05: revogar a versão, inativar e reativar o protocolo ──
type AcaoProtocolo = { tipo: 'revogar' | 'inativar' | 'reativar'; p: ProtocoloOncologicoLido };
const acao = ref<AcaoProtocolo | null>(null);
const dialogo = ref(false);
const dependencias = ref<DependenciasProtocolo | null>(null);
const erroDependencias = ref<unknown>(null);
const ciente = ref(false);
async function abrir(a: AcaoProtocolo): Promise<void> {
  acao.value = a;
  dependencias.value = null;
  erroDependencias.value = null;
  ciente.value = false;
  dialogo.value = true;
  if (a.tipo !== 'revogar') return;
  try {
    dependencias.value = await lerDependenciasProtocolo(a.p.id);
  } catch (x) {
    erroDependencias.value = x;
  }
}
const tituloAcao = computed(() =>
  acao.value
    ? t(`especialidades.oncologia.${acao.value.tipo}Titulo`, {
        codigo: acao.value.p.codigo,
        versao: acao.value.p.versao,
      })
    : '',
);
const incompleto = computed(
  () =>
    acao.value?.tipo === 'revogar' &&
    (dependencias.value === null || (dependencias.value.emAndamento > 0 && !ciente.value)),
);
function gravarAcao({ motivo, senha }: { motivo: string; senha: string }) {
  const a = acao.value;
  if (!a) return Promise.reject(new Error('sem ação'));
  const chave = novaChaveEspecialidade(`protocolo-${a.tipo}`);
  if (a.tipo === 'revogar')
    return revogarVersaoProtocolo(
      a.p.id,
      {
        motivo,
        cienteDosCiclos: ciente.value,
        ciclosVistos: dependencias.value?.emAndamento ?? 0,
        senha,
      },
      chave,
    );
  return mudarProtocolo(a.p.id, a.tipo, a.tipo === 'inativar' ? { motivo, senha } : { motivo }, chave);
}
async function feito(r: unknown): Promise<void> {
  erro.value = null;
  mensagem.value = (r as { mensagem: string }).mensagem;
  await dados.refetch();
}
const eventoTexto = (e: EventoOncoLido) =>
  [
    t('especialidades.oncologia.eventoLinha', {
      evento: t(`especialidades.oncologia.eventosNomes.${e.evento}`),
      em: instanteCurto(e.em),
      por: e.por,
      motivo: e.motivo,
    }),
    e.ciclosAfetados !== null ? t('especialidades.oncologia.eventoCiclos', { n: e.ciclosAfetados }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
const imprimir = () => window.print();

const oferecidos = computed(() => (dados.data.value?.protocolos ?? []).filter((p) => p.ofertavel));
const fora = computed(() => (dados.data.value?.protocolos ?? []).filter((p) => !p.ofertavel));
const abas = computed(() => [
  { id: 'oferecidos', rotulo: t('especialidades.oncologia.abas.oferecidos'), n: oferecidos.value.length },
  { id: 'fora', rotulo: t('especialidades.oncologia.abas.fora'), n: fora.value.length },
  { id: 'publicar', rotulo: t('especialidades.oncologia.abas.publicar') },
]);
const grupos = computed(() => [
  { id: 'oferecidos', itens: oferecidos.value },
  { id: 'fora', itens: fora.value },
]);
const codigos = computed(() => new Set((dados.data.value?.protocolos ?? []).map((p) => p.codigo)).size);
</script>

<template>
  <section
    class="tela-agenda tela-correcoes"
    aria-labelledby="protocolos-titulo"
    data-testid="tela-protocolos-onco"
  >
    <CartaoPerfil
      id-titulo="protocolos-titulo"
      :titulo="t('especialidades.oncologia.protocolos')"
      iniciais="QT"
      :linhas="[
        t('especialidades.oncologia.protocolosTexto'),
        ...(dados.data.value
          ? [
              t('especialidades.oncologia.catalogoLinha', {
                versoes: dados.data.value.protocolos.length,
                codigos,
              }),
            ]
          : []),
      ]"
    >
      <template #pilulas>
        <span class="pilula pilula--ok">{{
          t('especialidades.oncologia.pilulaOferecidos', { n: oferecidos.length })
        }}</span>
        <span class="pilula pilula--neutra">{{
          t('especialidades.oncologia.pilulaFora', { n: fora.length })
        }}</span>
      </template>
      <template #acoes>
        <SanteBotao
          variante="secundario"
          :rotulo="t('especialidades.oncologia.imprimir')"
          :title="t('especialidades.oncologia.imprimirAjuda')"
          data-testid="protocolos-imprimir"
          @acionar="imprimir"
        />
      </template>
    </CartaoPerfil>
    <p class="acoes nao-imprimir">
      <RouterLink to="/pep/especialidades/oncologia">{{ t('especialidades.voltar') }}</RouterLink>
      <RouterLink to="/consultas/item/pep.especialidades.oncologia-protocolos-de-quimioterapia">{{
        t('especialidades.oncologia.cadastros')
      }}</RouterLink>
    </p>
    <AvisoEspecialidade :motivo="aviso" />
    <SanteAlerta
      v-if="mensagem"
      variante="info"
      :texto="mensagem"
      anunciar
      data-testid="protocolo-mensagem"
    />
    <AbasFicha
      v-model="aba"
      :abas="abas"
      prefixo="protocolos"
      :rotulo="t('especialidades.oncologia.abasProtocolosRotulo')"
    />
    <ErroEspecialidade v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="!dados.data.value" role="status">{{ t('especialidades.carregando') }}</p>
    <template v-else>
      <div
        v-for="g in grupos"
        v-show="aba === g.id"
        :id="`protocolos-painel-${g.id}`"
        :key="g.id"
        class="painel-aba"
        role="tabpanel"
        :aria-labelledby="`protocolos-aba-${g.id}`"
      >
        <section class="painel" :aria-labelledby="`protocolos-lista-${g.id}`">
          <h2 :id="`protocolos-lista-${g.id}`">{{ t(`especialidades.oncologia.abas.${g.id}`) }}</h2>
          <p v-if="g.itens.length === 0">{{ t('especialidades.oncologia.semProtocolos') }}</p>
          <article
            v-for="p in g.itens"
            :key="p.id"
            :class="['cartao-registro', { inativo: p.revogada || p.inativo }]"
            :data-testid="`protocolo-${p.codigo}-v${p.versao}`"
            :data-ofertavel="p.ofertavel ? 'sim' : 'nao'"
          >
            <p>
              <strong>{{
                t('especialidades.un.versao', { codigo: p.codigo, versao: p.versao, nome: p.nome })
              }}</strong>
              <span class="chip">{{
                p.vigente ? t('especialidades.oncologia.vigente') : t('especialidades.oncologia.substituida')
              }}</span>
              <span v-if="!p.integro" class="chip alerta-texto">{{
                t('especialidades.oncologia.naoIntegro')
              }}</span>
              <span
                v-if="p.revogada"
                class="pilula pilula--alerta"
                :data-testid="`protocolo-revogada-${p.id}`"
                >{{ t('especialidades.oncologia.revogada') }}</span
              >
              <span
                v-if="p.inativo"
                class="pilula pilula--neutra"
                :data-testid="`protocolo-inativo-${p.id}`"
                >{{ t('especialidades.oncologia.inativo') }}</span
              >
              <span :class="['pilula', p.ofertavel ? 'pilula--ok' : 'pilula--neutra']">{{
                p.ofertavel
                  ? t('especialidades.oncologia.ofertavel')
                  : t('especialidades.oncologia.naoOfertavel')
              }}</span>
            </p>
            <p class="secundario">
              {{ p.tipo.nome }} ·
              {{ t('especialidades.oncologia.intervaloCiclos', { dias: p.intervaloDias, n: p.ciclos }) }} ·
              {{ p.por }} · {{ instanteCurto(p.em) }}
            </p>
            <ul class="lista-simples">
              <li v-for="(f, i) in p.farmacos" :key="i">
                {{ f.nome }}: {{ numero(f.dose) }} {{ unidadeTexto(f.unidade) }}, {{ viaTexto(f.via) }},
                {{ t('especialidades.oncologia.dias', { dias: f.dias.join(', ') }) }}
                <span v-if="f.administracao"> · {{ f.administracao }}</span>
              </li>
            </ul>
            <p class="secundario">{{ t('especialidades.oncologia.referencia') }}: {{ p.referencia }}</p>
            <details v-if="p.eventos.length" open :data-testid="`protocolo-eventos-${p.id}`">
              <summary>{{ t('especialidades.oncologia.eventos') }} ({{ p.eventos.length }})</summary>
              <ul class="eventos">
                <li v-for="e in p.eventos" :key="e.id">{{ eventoTexto(e) }}</li>
              </ul>
            </details>
            <p v-if="pode" class="acoes-registro nao-imprimir">
              <SanteBotao
                v-if="p.vigente && !p.inativo"
                variante="texto"
                :rotulo="t('especialidades.oncologia.novaVersao')"
                :data-testid="`protocolo-nova-versao-${p.codigo}`"
                @click="aPartirDe(p)"
              />
              <SanteBotao
                v-if="!p.revogada"
                variante="secundario"
                :rotulo="t('especialidades.oncologia.revogar')"
                :data-testid="`protocolo-revogar-${p.id}`"
                @acionar="abrir({ tipo: 'revogar', p })"
              />
              <SanteBotao
                v-if="p.vigente && !p.inativo"
                variante="texto"
                :rotulo="t('especialidades.oncologia.inativar')"
                :data-testid="`protocolo-inativar-${p.id}`"
                @acionar="abrir({ tipo: 'inativar', p })"
              />
              <SanteBotao
                v-if="p.vigente && p.inativo"
                variante="secundario"
                :rotulo="t('especialidades.oncologia.reativar')"
                :data-testid="`protocolo-reativar-${p.id}`"
                @acionar="abrir({ tipo: 'reativar', p })"
              />
            </p>
          </article>
        </section>
      </div>
      <DialogoCorrecao
        v-model:visivel="dialogo"
        :titulo="tituloAcao"
        :texto="acao ? t(`especialidades.oncologia.${acao.tipo}Texto`) : ''"
        :confirmar="acao ? t(`especialidades.oncologia.${acao.tipo}`) : ''"
        :critica="acao?.tipo !== 'reativar'"
        :incompleto="incompleto"
        :gravar="gravarAcao"
        @feito="feito"
      >
        <template v-if="acao?.tipo === 'revogar'">
          <ErroEspecialidade v-if="erroDependencias" :erro="erroDependencias" />
          <p v-else-if="!dependencias" role="status">{{ t('especialidades.oncologia.carregandoCiclos') }}</p>
          <div v-else data-testid="revogar-ciclos">
            <p>
              <strong>{{
                t('especialidades.oncologia.ciclosDaVersao', {
                  andamento: dependencias.emAndamento,
                  total: dependencias.total,
                })
              }}</strong>
            </p>
            <ul v-if="dependencias.ciclos.length" class="lista-simples">
              <li v-for="c in dependencias.ciclos" :key="c.id">
                {{
                  t('especialidades.oncologia.cicloDependente', {
                    n: c.numero,
                    curso: c.curso,
                    internacao: c.internacao,
                    data: dataLonga(c.dataPrevista),
                    situacao: t(`especialidades.oncologia.situacoes.${c.situacao}`),
                    andamento: t(`especialidades.oncologia.andamentos.${c.andamento}`),
                  })
                }}
              </li>
            </ul>
            <p v-if="dependencias.cortada" data-testid="revogar-cortada">
              {{
                t('especialidades.oncologia.ciclosCortados', {
                  n: dependencias.ciclos.length,
                  total: dependencias.total,
                })
              }}
            </p>
            <label v-if="dependencias.emAndamento > 0" class="opcao">
              <input v-model="ciente" type="checkbox" data-testid="revogar-ciente" />
              {{ t('especialidades.oncologia.ciente', { n: dependencias.emAndamento }) }}
            </label>
          </div>
        </template>
      </DialogoCorrecao>
    </template>
    <div
      v-show="aba === 'publicar'"
      id="protocolos-painel-publicar"
      class="painel-aba nao-imprimir"
      role="tabpanel"
      aria-labelledby="protocolos-aba-publicar"
    >
      <section class="painel" aria-labelledby="protocolo-novo">
        <h2 id="protocolo-novo">{{ t('especialidades.oncologia.publicar') }}</h2>
        <p v-if="!pode" class="secundario">{{ motivoPode }}</p>
        <form v-else class="formulario" data-testid="form-protocolo" @submit.prevent="publicar">
          <div class="grade">
            <SanteCampoTexto
              v-model="codigo"
              :rotulo="t('especialidades.oncologia.codigo')"
              :max-bytes="20"
              obrigatorio
            />
            <SanteCampoTexto
              v-model="nome"
              :rotulo="t('especialidades.oncologia.nome')"
              :max-bytes="100"
              obrigatorio
            />
            <SanteSelecao
              v-model="tipo"
              :rotulo="t('especialidades.oncologia.tipo')"
              :opcoes="tipos"
              obrigatorio
            />
            <div class="campo">
              <label for="proto-intervalo">{{ t('especialidades.oncologia.intervalo') }}</label>
              <input id="proto-intervalo" v-model="intervalo" type="number" min="1" max="56" required />
            </div>
            <div class="campo">
              <label for="proto-ciclos">{{ t('especialidades.oncologia.ciclos') }}</label>
              <input id="proto-ciclos" v-model="ciclos" type="number" min="1" max="24" required />
            </div>
          </div>
          <fieldset class="itens">
            <legend>{{ t('especialidades.oncologia.farmacos') }}</legend>
            <div v-for="(f, i) in farmacos" :key="i" class="grade" :data-testid="`farmaco-${i}`">
              <SanteCampoTexto
                v-model="f.nome"
                :rotulo="t('especialidades.oncologia.farmaco', { n: i + 1 })"
                :max-bytes="60"
              />
              <div class="campo">
                <label :for="`farmaco-dose-${i}`">{{
                  t('especialidades.oncologia.dose', { n: i + 1 })
                }}</label>
                <input
                  :id="`farmaco-dose-${i}`"
                  v-model="f.dose"
                  type="text"
                  inputmode="decimal"
                  maxlength="10"
                />
              </div>
              <SanteSelecao
                v-model="f.unidade"
                :rotulo="t('especialidades.oncologia.unidade', { n: i + 1 })"
                :opcoes="unidades"
              />
              <SanteSelecao
                v-model="f.via"
                :rotulo="t('especialidades.oncologia.via', { n: i + 1 })"
                :opcoes="vias"
              />
              <SanteCampoTexto
                v-model="f.dias"
                :rotulo="t('especialidades.oncologia.diasDe', { n: i + 1 })"
                :max-bytes="60"
              />
              <SanteCampoTexto
                v-model="f.administracao"
                :rotulo="t('especialidades.oncologia.administracao', { n: i + 1 })"
                :max-bytes="120"
              />
              <SanteBotao
                v-if="farmacos.length > 1"
                variante="texto"
                :rotulo="t('especialidades.remover')"
                @click="farmacos.splice(i, 1)"
              />
            </div>
            <SanteBotao
              variante="secundario"
              :rotulo="t('especialidades.oncologia.adicionarFarmaco')"
              data-testid="protocolo-adicionar-farmaco"
              @click="farmacos.push(novoFarmaco())"
            />
          </fieldset>
          <SanteCampoTexto
            v-model="indicacao"
            :rotulo="t('especialidades.oncologia.indicacao')"
            :max-bytes="200"
          />
          <SanteCampoTexto
            v-model="referencia"
            :rotulo="t('especialidades.oncologia.referencia')"
            :max-bytes="200"
            obrigatorio
          />
          <ErroEspecialidade v-if="erro" :erro="erro" />
          <SanteBotao
            tipo="submit"
            :rotulo="t('especialidades.oncologia.publicarBotao')"
            :desabilitado="ocupado || tipo === null"
            data-testid="protocolo-publicar"
          />
        </form>
      </section>
    </div>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="./estilo-especialidades.css"></style>
<style src="../../nutricao/componentes/estilo-correcao.css"></style>
