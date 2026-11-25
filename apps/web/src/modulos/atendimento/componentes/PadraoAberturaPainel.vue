<script setup lang="ts">
// Valores habituais da abertura do atendimento (na tela da herança): o que a ficha traz preenchido para o paciente
// SEM atendimento anterior, ou no campo que a herança não trouxe. Duas colunas, cada uma com o seu botão: a do
// estabelecimento (vale para todos) e a pessoal (só para mim; "segue o estabelecimento" limpa o valor pessoal). A
// coluna "em vigor" mostra na hora o que a ficha vai receber; o item que deixou de valer aparece com o aviso. A
// gravação confere a versão lida (outra estação mudou: o aviso e a releitura).
import { CAMPOS_PADRAO_ABERTURA, type CampoPadraoAbertura } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  definirMeuPadraoAbertura,
  definirPadraoAbertura,
  lerPadraoAbertura,
  novaChave,
} from '../api-atendimento.js';
import { recarregarRascunho } from '../rascunho-padrao.js';
import { usarAtendimento } from '../usar-atendimento.js';
import ErroAtendimento from './ErroAtendimento.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const { apoio, pode } = usarAtendimento();
const cfg = useQuery({ queryKey: ['atendimento', 'padrao-abertura'], queryFn: () => lerPadraoAbertura() });
const podeEstabelecimento = pode('atendimento.definirPadraoAbertura');
const podePessoal = pode('atendimento.definirMeuPadraoAbertura');

type Valores = Record<string, string>;
const doEstabelecimento = ref<Valores>({});
const pessoal = ref<Valores>({});
const texto = (v: { id: number } | null): string => (v ? String(v.id) : '');
// A releitura (depois de gravar um escopo, ou de outra estação mudar) traz o que está gravado, mas não descarta o que
// a pessoa mudou na tela e ainda não gravou: gravar o estabelecimento não apaga a escolha pessoal pendente.
type Configuracao = NonNullable<typeof cfg.data.value>;
const lidos = (c: Configuracao | undefined, escopo: 'estabelecimento' | 'pessoal') =>
  c?.campos.map((x) => ({ campo: x.campo, id: x[escopo]?.id ?? null }));
watch(
  () => cfg.data.value,
  (c, anterior) => {
    if (!c) return;
    doEstabelecimento.value = recarregarRascunho(
      doEstabelecimento.value,
      lidos(c, 'estabelecimento') ?? [],
      lidos(anterior, 'estabelecimento'),
    );
    pessoal.value = recarregarRascunho(pessoal.value, lidos(c, 'pessoal') ?? [], lidos(anterior, 'pessoal'));
  },
  { immediate: true },
);

/** As opções de cada campo: o que a abertura aceita hoje; o item gravado que saiu de uso aparece marcado. */
function opcoes(campo: string, vazio: string, gravado: { id: number; rotulo: string; vale: boolean } | null) {
  const a = apoio.data.value;
  const lista =
    campo === 'convenio'
      ? (a?.convenios ?? []).filter((x) => x.aceita)
      : campo === 'unidade'
        ? (a?.unidades ?? [])
        : campo === 'especialidade'
          ? (a?.especialidades ?? [])
          : (a?.centrosCusto ?? []);
  const itens = lista.map((x) => ({ valor: String(x.codigo), rotulo: x.nome }));
  if (gravado && !itens.some((x) => x.valor === String(gravado.id)))
    itens.unshift({
      valor: String(gravado.id),
      rotulo: t('atendimento.padraoAbertura.foraDeUso', { nome: gravado.rotulo }),
    });
  return [{ valor: '', rotulo: vazio }, ...itens];
}
const nome = (campo: string, valor: string): string =>
  opcoes(campo, '', null).find((x) => x.valor === valor)?.rotulo ?? valor;

/** O que a ficha vai receber com o que está na tela (antes de gravar): o pessoal vence o do estabelecimento. */
function emVigor(campo: string): string {
  const p = pessoal.value[campo] ?? '';
  const e = doEstabelecimento.value[campo] ?? '';
  if (p) return t('atendimento.padraoAbertura.vigorPessoal', { nome: nome(campo, p) });
  if (e) return t('atendimento.padraoAbertura.vigorEstabelecimento', { nome: nome(campo, e) });
  return t('atendimento.padraoAbertura.semValor');
}
const foraDeUso = computed(() =>
  (cfg.data.value?.campos ?? []).flatMap((c) =>
    [c.pessoal, c.estabelecimento]
      .filter((x) => x && !x.vale)
      .map((x) => t('atendimento.padraoAbertura.avisoForaDeUso', { campo: c.rotulo, nome: x?.rotulo ?? '' })),
  ),
);
const mudou = (atual: Valores, escopo: 'estabelecimento' | 'pessoal') =>
  (cfg.data.value?.campos ?? []).filter((c) => (atual[c.campo] ?? '') !== texto(c[escopo]));
const mudouEstabelecimento = computed(() => mudou(doEstabelecimento.value, 'estabelecimento'));
const mudouPessoal = computed(() => mudou(pessoal.value, 'pessoal'));

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function gravar(paraMim: boolean): Promise<void> {
  const c = cfg.data.value;
  if (!c) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const atual = paraMim ? pessoal.value : doEstabelecimento.value;
    const valores = Object.fromEntries(
      (paraMim ? mudouPessoal.value : mudouEstabelecimento.value).map((x) => [
        x.campo,
        atual[x.campo] ? Number(atual[x.campo]) : null,
      ]),
    );
    const r = paraMim
      ? await definirMeuPadraoAbertura({ valores, versao: c.versaoPessoal }, novaChave('padrao-meu'))
      : await definirPadraoAbertura({ valores, versao: c.versaoEstabelecimento }, novaChave('padrao'));
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['atendimento'] });
  } catch (x) {
    erro.value = x;
    await cfg.refetch();
  } finally {
    ocupado.value = false;
  }
}
const campos = computed(() =>
  (cfg.data.value?.campos ?? []).filter((c) =>
    CAMPOS_PADRAO_ABERTURA.some((x) => x.campo === (c.campo as CampoPadraoAbertura)),
  ),
);
</script>

<template>
  <section aria-labelledby="padrao-abertura-titulo" data-testid="painel-padrao-abertura">
    <h2 id="padrao-abertura-titulo">{{ t('atendimento.padraoAbertura.titulo') }}</h2>
    <p>{{ t('atendimento.padraoAbertura.texto') }}</p>
    <ErroAtendimento v-if="cfg.isError.value" :erro="cfg.error.value" />
    <p v-else-if="!cfg.data.value" role="status">{{ t('atendimento.carregando') }}</p>
    <form v-else class="painel" @submit.prevent>
      <SanteAlerta
        v-for="(aviso, i) in foraDeUso"
        :key="`fora-${i}`"
        variante="alerta"
        :texto="aviso"
        data-testid="padrao-fora-de-uso"
      />
      <table class="tabela" data-testid="tabela-padrao-abertura">
        <thead>
          <tr>
            <th scope="col">{{ t('atendimento.heranca.campos') }}</th>
            <th scope="col">{{ t('atendimento.heranca.estabelecimento') }}</th>
            <th scope="col">{{ t('atendimento.heranca.paraMim') }}</th>
            <th scope="col">{{ t('atendimento.padraoAbertura.emVigor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in campos" :key="c.campo">
            <th scope="row">{{ c.rotulo }}</th>
            <td>
              <SanteSelecao
                :model-value="doEstabelecimento[c.campo] ?? ''"
                :desabilitado="!podeEstabelecimento"
                ocultar-rotulo
                :rotulo="`${c.rotulo}: ${t('atendimento.heranca.estabelecimento')}`"
                :opcoes="opcoes(c.campo, t('atendimento.padraoAbertura.semValor'), c.estabelecimento)"
                :data-testid="`padrao-estabelecimento-${c.campo}`"
                @update:model-value="(v) => (doEstabelecimento[c.campo] = v)"
              />
            </td>
            <td>
              <SanteSelecao
                :model-value="pessoal[c.campo] ?? ''"
                :desabilitado="!podePessoal"
                ocultar-rotulo
                :rotulo="`${c.rotulo}: ${t('atendimento.heranca.paraMim')}`"
                :opcoes="opcoes(c.campo, t('atendimento.heranca.segue'), c.pessoal)"
                :data-testid="`padrao-pessoal-${c.campo}`"
                @update:model-value="(v) => (pessoal[c.campo] = v)"
              />
            </td>
            <td :data-testid="`padrao-vigor-${c.campo}`">{{ emVigor(c.campo) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="podeEstabelecimento || podePessoal" class="acoes">
        <SanteBotao
          v-if="podeEstabelecimento"
          :rotulo="t('atendimento.heranca.gravarEstabelecimento')"
          :desabilitado="!mudouEstabelecimento.length || ocupado"
          data-testid="botao-gravar-padrao"
          @acionar="gravar(false)"
        />
        <SanteBotao
          v-if="podePessoal"
          :rotulo="t('atendimento.heranca.gravarPessoal')"
          :desabilitado="!mudouPessoal.length || ocupado"
          data-testid="botao-gravar-padrao-pessoal"
          @acionar="gravar(true)"
        />
      </p>
      <p v-if="mensagem" role="status" data-testid="mensagem-padrao-abertura">{{ mensagem }}</p>
      <ErroAtendimento v-if="erro" :erro="erro" />
    </form>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
