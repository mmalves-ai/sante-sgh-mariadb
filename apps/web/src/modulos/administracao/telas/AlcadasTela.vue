<script setup lang="ts">
// Alçadas de aprovação (01-ADM L59, escopo do usuário). Uma tela só: à esquerda as regras do estabelecimento por tipo
// de documento (vigente, futura ou encerrada, com os níveis e quantos pedidos já decidiu); à direita o formulário da
// regra, com os níveis em linhas (perfil ou conta, faixa de valor, teto acumulado e prazo). A validação roda na hora
// com a mesma regra do domínio que o servidor aplica (alcadas-tela.ts), e o botão só libera com a regra coerente.
// Encerrar fecha a vigência (a regra fica no histórico); a regra futura é desativada.
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  MENSAGEM_FORM,
  corpoDe,
  faixa,
  formDe,
  formVazio,
  nivelVazio,
  type AlcadaForm,
} from '../alcadas-tela.js';
import { buscarAlcadas, encerrarAlcadaApi, gravarAlcada, type AlcadaApi } from '../api-alcadas.js';

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Alçadas de aprovação',
      texto:
        'Quem aprova cada tipo de documento, em quantos níveis e até que valor. Cada linha de nível tem um aprovador: um perfil de acesso ou uma conta. Mudar os níveis de uma regra que já decidiu pedidos exige uma vigência nova; a anterior fica no histórico.',
      voltar: 'Usuários',
      carregando: 'Carregando…',
      nenhuma: 'Nenhuma regra de alçada neste estabelecimento.',
      nova: 'Nova regra',
      editar: 'Alterar',
      encerrar: 'Encerrar',
      vigente: 'vigente',
      futura: 'começa em {data}',
      encerrada: 'encerrada',
      pedidos: '{n} pedido(s) decidido(s)',
      niveis: '{n} nível(is)',
      documento: 'Tipo de documento',
      escolha: 'Escolha',
      descricao: 'Nome da regra',
      modo: 'Como os níveis aprovam',
      serie: 'Em série (um nível depois do outro)',
      paralelo: 'Em paralelo (todos ao mesmo tempo)',
      prazo: 'Prazo da regra (horas)',
      acaoPrazo: 'Quando o prazo vence',
      alertar: 'Alertar o aprovador',
      escalar: 'Passar ao nível de cima',
      recusar: 'Recusar o pedido',
      autoaprovacao: 'Quem pede pode aprovar o próprio pedido',
      justificativa: 'Recusa exige justificativa',
      inicio: 'Início da vigência',
      fim: 'Fim da vigência (vazio: sem fim)',
      nivelTitulo: 'Níveis de aprovação',
      nivel: 'Nível',
      tipo: 'Aprovador',
      perfil: 'Perfil de acesso',
      conta: 'Conta (login)',
      minimo: 'Valor mínimo (R$)',
      maximo: 'Teto (R$; vazio: sem teto)',
      acumulado: 'Teto acumulado (R$)',
      periodo: 'Período do acumulado',
      semPeriodo: 'Sem acumulado',
      dia: 'Dia',
      semana: 'Semana',
      mes: 'Mês',
      ano: 'Ano',
      prazoNivel: 'Prazo do nível (horas)',
      obrigatorio: 'Nível obrigatório',
      maisLinha: 'Mais um aprovador neste nível',
      maisNivel: 'Mais um nível',
      tirar: 'Tirar a linha',
      gravar: 'Gravar a regra',
      gravando: 'Gravando…',
      cancelar: 'Cancelar',
      fimEncerrar: 'Encerrar em (vazio: hoje)',
      confirmarEncerrar: 'Confirmar o encerramento',
      feitoGravar: 'Regra gravada.',
      feitoGravarEncerrou: 'Regra gravada; a regra anterior do documento foi encerrada na véspera.',
      feitoEncerrar: 'Regra encerrada.',
      feitoDesativar: 'A regra ainda não tinha começado e foi desativada.',
      emUso: 'Esta regra já decidiu pedidos: mudar os níveis pede uma vigência nova.',
      semEdicao: 'Seu perfil pode consultar as alçadas, mas não alterá-las.',
    },
  },
});

const hoje = () => new Date().toISOString().slice(0, 10);
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const podeEditar = computed(() => pode('acesso.escopo.editar'));
const cliente = useQueryClient();
const painel = useQuery({ queryKey: ['adm', 'alcadas'], queryFn: () => buscarAlcadas() });

const form = ref<AlcadaForm | null>(null);
const emUso = ref(false);
const gravando = ref(false);
const erro = ref<unknown>(null);
const feito = ref('');
const encerrando = ref<AlcadaApi | null>(null);
const fimEncerrar = ref('');

const opcoesDocumento = computed(() => [
  { valor: '', rotulo: t('escolha') },
  ...(painel.data.value?.documentos ?? []).map((d) => ({ valor: d.codigo, rotulo: d.descricao })),
]);
const opcoesPerfil = computed(() => [
  { valor: '', rotulo: t('escolha') },
  ...(painel.data.value?.perfis ?? []).map((p) => ({ valor: p.codigo, rotulo: p.nome })),
]);
const opcoesModo = computed(() => [
  { valor: 'serie', rotulo: t('serie') },
  { valor: 'paralelo', rotulo: t('paralelo') },
]);
const opcoesAcao = computed(() =>
  (['alertar', 'escalar', 'recusar'] as const).map((v) => ({ valor: v, rotulo: t(v) })),
);
const opcoesTipo = computed(() => [
  { valor: 'perfil', rotulo: t('perfil') },
  { valor: 'conta', rotulo: t('conta') },
]);
const opcoesPeriodo = computed(() => [
  { valor: '', rotulo: t('semPeriodo') },
  ...(['dia', 'semana', 'mes', 'ano'] as const).map((v) => ({ valor: v, rotulo: t(v) })),
]);

const analise = computed(() => (form.value ? corpoDe(form.value) : null));
const problema = computed(() => (analise.value?.problema ? MENSAGEM_FORM[analise.value.problema] : ''));
const ultimoNivel = computed(() => form.value?.niveis.reduce((m, n) => Math.max(m, n.nivel), 0) ?? 0);

function situacao(a: AlcadaApi): string {
  if (a.vigente) return t('vigente');
  if (a.ativo && a.vigenciaInicio > hoje()) return t('futura', { data: a.vigenciaInicio });
  return t('encerrada');
}

function nova(): void {
  form.value = formVazio(hoje());
  emUso.value = false;
  feito.value = '';
  erro.value = null;
}
function alterar(a: AlcadaApi): void {
  form.value = formDe(a);
  emUso.value = a.pedidos > 0;
  feito.value = '';
  erro.value = null;
}
function maisNivel(): void {
  form.value?.niveis.push(nivelVazio(ultimoNivel.value + 1));
}
function maisLinha(nivel: number): void {
  const f = form.value;
  if (!f) return;
  const depois = f.niveis.findLastIndex((n) => n.nivel === nivel);
  f.niveis.splice(depois + 1, 0, nivelVazio(nivel));
}
function tirar(i: number): void {
  form.value?.niveis.splice(i, 1);
}

async function gravar(): Promise<void> {
  const a = analise.value;
  if (!a || a.problema !== null || gravando.value) return;
  gravando.value = true;
  erro.value = null;
  try {
    const r = await gravarAlcada(a.corpo);
    feito.value = r.encerrada ? t('feitoGravarEncerrou') : t('feitoGravar');
    form.value = null;
    await cliente.invalidateQueries({ queryKey: ['adm', 'alcadas'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}

async function encerrar(): Promise<void> {
  const a = encerrando.value;
  if (!a || gravando.value) return;
  gravando.value = true;
  erro.value = null;
  try {
    const r = await encerrarAlcadaApi(a.id, a.versao, fimEncerrar.value || null);
    feito.value = r.acao === 'desativar' ? t('feitoDesativar') : t('feitoEncerrar');
    encerrando.value = null;
    fimEncerrar.value = '';
    await cliente.invalidateQueries({ queryKey: ['adm', 'alcadas'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="tela alcadas" aria-labelledby="alcadas-titulo">
    <nav>
      <router-link :to="{ name: 'adm.usuarios' }" data-testid="alcadas-voltar">{{ t('voltar') }}</router-link>
    </nav>
    <h1 id="alcadas-titulo">{{ t('titulo') }}</h1>
    <p class="nota">{{ t('texto') }}</p>
    <SanteAlerta v-if="!podeEditar" :texto="t('semEdicao')" variante="info" />
    <p v-if="feito" role="status" data-testid="alcadas-feito">{{ feito }}</p>
    <MensagemErro v-if="painel.isError.value" :erro="painel.error.value" />
    <div class="colunas">
      <div class="lista" data-testid="alcadas-lista">
        <SanteBotao v-if="podeEditar" :rotulo="t('nova')" data-testid="alcada-nova" @acionar="nova" />
        <p v-if="painel.isPending.value">{{ t('carregando') }}</p>
        <p v-else-if="!painel.data.value?.alcadas.length" data-testid="alcadas-vazio">{{ t('nenhuma') }}</p>
        <article
          v-for="a in painel.data.value?.alcadas ?? []"
          :key="a.id"
          class="cartao"
          :data-testid="`alcada-${a.id}`"
        >
          <h2 class="cartao__titulo">{{ a.documentoDescricao }} · {{ a.descricao }}</h2>
          <p class="nota">
            {{ situacao(a) }} · {{ a.vigenciaInicio }}{{ a.vigenciaFim ? ` a ${a.vigenciaFim}` : '' }} ·
            {{ t('niveis', { n: a.quantidadeNiveis }) }} · {{ t('pedidos', { n: a.pedidos }) }}
          </p>
          <ul>
            <li v-for="(n, i) in a.niveis" :key="i">
              {{ t('nivel') }} {{ n.nivel }}: {{ n.usuario ?? n.perfil }} ({{
                faixa(n.valorMinimo, n.valorMaximo, moeda)
              }})
            </li>
          </ul>
          <div v-if="podeEditar && (a.vigente || a.ativo)" class="acoes">
            <SanteBotao
              :rotulo="t('editar')"
              variante="secundario"
              :data-testid="`alcada-editar-${a.id}`"
              @acionar="alterar(a)"
            />
            <SanteBotao
              :rotulo="t('encerrar')"
              variante="secundario"
              :data-testid="`alcada-encerrar-${a.id}`"
              @acionar="encerrando = a"
            />
          </div>
          <form
            v-if="encerrando?.id === a.id"
            class="form"
            data-testid="form-encerrar-alcada"
            @submit.prevent="encerrar"
          >
            <label class="campo"
              >{{ t('fimEncerrar') }}
              <input v-model="fimEncerrar" type="date" data-testid="alcada-fim-encerrar" />
            </label>
            <div class="acoes">
              <SanteBotao
                :rotulo="t('confirmarEncerrar')"
                tipo="submit"
                :desabilitado="gravando"
                data-testid="alcada-confirmar-encerrar"
              />
              <SanteBotao :rotulo="t('cancelar')" variante="secundario" @acionar="encerrando = null" />
            </div>
          </form>
        </article>
      </div>

      <form v-if="form" class="form cartao" data-testid="form-alcada" @submit.prevent="gravar">
        <MensagemErro v-if="erro" :erro="erro" />
        <SanteSelecao
          id="alcada-documento"
          v-model="form.documento"
          obrigatorio
          :rotulo="t('documento')"
          :opcoes="opcoesDocumento"
          :desabilitado="form.id !== null"
          data-testid="alcada-documento"
        />
        <SanteCampoTexto
          v-model="form.descricao"
          :rotulo="t('descricao')"
          :max-bytes="150"
          obrigatorio
          data-testid="alcada-descricao"
        />
        <div class="linha">
          <SanteSelecao
            id="alcada-modo"
            v-model="form.modo"
            :rotulo="t('modo')"
            :opcoes="opcoesModo"
            data-testid="alcada-modo"
          />
          <SanteCampoTexto
            v-model="form.prazoHoras"
            :rotulo="t('prazo')"
            :max-bytes="4"
            data-testid="alcada-prazo"
          />
          <SanteSelecao
            id="alcada-acao-prazo"
            v-model="form.acaoPrazoVencido"
            :rotulo="t('acaoPrazo')"
            :opcoes="opcoesAcao"
            data-testid="alcada-acao-prazo"
          />
        </div>
        <div class="linha">
          <label class="campo"
            >{{ t('inicio') }}
            <input v-model="form.vigenciaInicio" type="date" required data-testid="alcada-inicio" />
          </label>
          <label class="campo"
            >{{ t('fim') }}
            <input v-model="form.vigenciaFim" type="date" data-testid="alcada-fim" />
          </label>
        </div>
        <label class="marca"
          ><input v-model="form.permiteAutoaprovacao" type="checkbox" />{{ t('autoaprovacao') }}</label
        >
        <label class="marca"
          ><input v-model="form.exigeJustificativaRecusa" type="checkbox" />{{ t('justificativa') }}</label
        >

        <h2 class="cartao__titulo">{{ t('nivelTitulo') }}</h2>
        <SanteAlerta v-if="emUso" :texto="t('emUso')" variante="aviso" />
        <fieldset v-for="(n, i) in form.niveis" :key="i" class="nivel" :data-testid="`alcada-linha-${i}`">
          <legend>{{ t('nivel') }} {{ n.nivel }}</legend>
          <div class="linha">
            <SanteSelecao
              :id="`alcada-tipo-${i}`"
              v-model="n.tipo"
              :rotulo="t('tipo')"
              :opcoes="opcoesTipo"
              :data-testid="`alcada-tipo-${i}`"
            />
            <SanteSelecao
              v-if="n.tipo === 'perfil'"
              :id="`alcada-perfil-${i}`"
              v-model="n.aprovador"
              obrigatorio
              :rotulo="t('perfil')"
              :opcoes="opcoesPerfil"
              :data-testid="`alcada-perfil-${i}`"
            />
            <SanteCampoTexto
              v-else
              v-model="n.aprovador"
              :rotulo="t('conta')"
              :max-bytes="60"
              obrigatorio
              :data-testid="`alcada-conta-${i}`"
            />
          </div>
          <div class="linha">
            <SanteCampoTexto
              v-model="n.valorMinimo"
              :rotulo="t('minimo')"
              :max-bytes="20"
              :data-testid="`alcada-minimo-${i}`"
            />
            <SanteCampoTexto
              v-model="n.valorMaximo"
              :rotulo="t('maximo')"
              :max-bytes="20"
              :data-testid="`alcada-maximo-${i}`"
            />
            <SanteCampoTexto
              v-model="n.acumulado"
              :rotulo="t('acumulado')"
              :max-bytes="20"
              :data-testid="`alcada-acumulado-${i}`"
            />
            <SanteSelecao
              :id="`alcada-periodo-${i}`"
              v-model="n.periodo"
              :rotulo="t('periodo')"
              :opcoes="opcoesPeriodo"
              :data-testid="`alcada-periodo-${i}`"
            />
            <SanteCampoTexto
              v-model="n.prazoHoras"
              :rotulo="t('prazoNivel')"
              :max-bytes="4"
              :data-testid="`alcada-prazo-${i}`"
            />
          </div>
          <label class="marca"><input v-model="n.obrigatorio" type="checkbox" />{{ t('obrigatorio') }}</label>
          <div class="acoes">
            <SanteBotao
              :rotulo="t('maisLinha')"
              variante="secundario"
              :data-testid="`alcada-mais-linha-${i}`"
              @acionar="maisLinha(n.nivel)"
            />
            <SanteBotao
              v-if="form.niveis.length > 1"
              :rotulo="t('tirar')"
              variante="secundario"
              :data-testid="`alcada-tirar-${i}`"
              @acionar="tirar(i)"
            />
          </div>
        </fieldset>
        <SanteBotao
          :rotulo="t('maisNivel')"
          variante="secundario"
          data-testid="alcada-mais-nivel"
          @acionar="maisNivel"
        />
        <p v-if="problema" class="problema" role="alert" data-testid="alcada-problema">{{ problema }}</p>
        <div class="acoes">
          <SanteBotao
            :rotulo="gravando ? t('gravando') : t('gravar')"
            tipo="submit"
            :desabilitado="!!problema || gravando"
            data-testid="alcada-gravar"
          />
          <SanteBotao
            :rotulo="t('cancelar')"
            variante="secundario"
            data-testid="alcada-cancelar"
            @acionar="form = null"
          />
        </div>
      </form>
    </div>
  </section>
</template>

<style scoped>
.alcadas {
  display: grid;
  gap: var(--sgh-espaco-3);
  min-width: 0;
}
.colunas {
  display: grid;
  gap: var(--sgh-espaco-4);
  grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr));
  align-items: start;
}
.lista,
.form {
  display: grid;
  gap: var(--sgh-espaco-3);
  min-width: 0;
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
}
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.marca {
  display: flex;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.nivel {
  display: grid;
  gap: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-3);
}
.nota {
  color: var(--sgh-texto-secundario);
  margin: 0;
}
.problema {
  color: var(--sgh-alerta);
  margin: 0;
}
</style>
